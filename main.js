const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const { Client } = require("minecraft-launcher-core");
const { autoUpdater } = require("electron-updater");

const CONFIG_PATH = path.join(__dirname, "config.json"); // запасной вариант, если сеть недоступна
const CONFIG_URL = "https://raw.githubusercontent.com/meRockstar67/coceLand/main/config.json";
const CONFIG_CACHE_PATH = path.join(app.getPath("userData"), "config-cache.json");
// Небольшой файл настроек (путь к папке установки) - сам всегда лежит в userData,
// это единственное, что остаётся на диске C, всё остальное (игра/моды) - там, где укажет игрок.
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
const DEFAULT_MC_DIR = path.join(app.getPath("userData"), "gamedata");

let mainWindow;
let launcher = new Client();
let cachedAuth = null; // авторизация Microsoft, кэшируется после первого входа
let gameProcess = null; // ссылка на запущенный процесс игры, чтобы можно было закрыть

ipcMain.handle("close-game", () => {
  if (gameProcess) {
    gameProcess.kill();
    gameProcess = null;
    return { ok: true };
  }
  return { ok: false };
});

// ---------- настройки (путь установки) ----------
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function getMcDir() {
  const settings = loadSettings();
  return settings.installDir || DEFAULT_MC_DIR;
}

ipcMain.handle("get-install-dir", () => getMcDir());

ipcMain.handle("get-ram", async () => {
  const settings = loadSettings();
  if (settings.ramMaxMb) return settings.ramMaxMb;

  const cfg = await loadConfig();
  const raw = (cfg.ram && cfg.ram.max) || "4096M";
  const match = raw.match(/^(\d+)([GgMm])$/);
  if (!match) return 4096;
  const num = parseInt(match[1], 10);
  return /[Gg]/.test(match[2]) ? num * 1024 : num;
});

ipcMain.handle("set-ram", (_event, mb) => {
  const settings = loadSettings();
  settings.ramMaxMb = mb;
  saveSettings(settings);
  return { ok: true };
});

ipcMain.handle("choose-install-dir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Выбери папку для установки coceLand",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };

  const chosen = path.join(result.filePaths[0], "coceLand-data");
  const settings = loadSettings();
  settings.installDir = chosen;
  saveSettings(settings);
  return { ok: true, path: chosen };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    autoHideMenuBar: true,
    title: "coceLand",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => autoUpdater.checkForUpdates(), 2000);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- автообновление ----------
autoUpdater.on("update-downloaded", () => {
  if (mainWindow) mainWindow.webContents.send("update-ready");
});
autoUpdater.on("error", () => {});

ipcMain.handle("install-update", () => {
  autoUpdater.quitAndInstall();
});

// ---------- Java: проверяем версию (NeoForge 1.21.1 требует Java 21+) ----------
function getJavaMajorVersion(javaPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(javaPath, ["-version"]);
    let out = "";
    proc.stderr.on("data", (d) => (out += d.toString()));
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", (err) => reject(new Error(`Java не найдена (${javaPath}): ${err.message}`)));
    proc.on("close", () => {
      const match = out.match(/version "(\d+)(\.(\d+))?/);
      if (!match) return reject(new Error(`Не удалось определить версию Java из вывода: ${out.slice(0, 200)}`));
      const first = parseInt(match[1], 10);
      const major = first === 1 ? parseInt(match[3], 10) : first;
      resolve(major);
    });
  });
}

async function ensureJavaVersion(cfg) {
  const javaPath = cfg.javaPath || "java";
  const major = await getJavaMajorVersion(javaPath);
  if (major < 21) {
    throw new Error(
      `Найдена Java ${major}, а для Minecraft 1.21.1/NeoForge нужна Java 21+. ` +
        `Поставь JDK 21 (например с adoptium.net) и, если это не единственная Java в системе, ` +
        `укажи путь к ней в config.json в поле "javaPath".`
    );
  }
  return javaPath;
}

// ---------- launcher_profiles.json: инсталлятор NeoForge требует его наличия ----------
function ensureLauncherProfiles(mcDir) {
  const dest = path.join(mcDir, "launcher_profiles.json");
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(mcDir, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2));
}

// ---------- вспомогательное ----------
function sendProgress(percent, label) {
  if (mainWindow) mainWindow.webContents.send("progress", { percent, label });
}

function log(msg) {
  console.log(msg);
  if (mainWindow) mainWindow.webContents.send("log", msg);
}

// ---------- скачивание JSON по URL (с таймаутом) ----------
function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchJson(res.headers.location, timeoutMs));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} при запросе ${url}`));
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Таймаут запроса"));
    });
  });
}

// config.json теперь тянется с GitHub при каждом запуске (актуальный список модов
// без необходимости обновлять сам лаунчер). Если сети нет - берём последнюю
// успешно скачанную копию, а если и её нет - вшитую в лаунчер версию.
async function loadConfig() {
  try {
    const remote = await fetchJson(CONFIG_URL);
    fs.writeFileSync(CONFIG_CACHE_PATH, JSON.stringify(remote, null, 2));
    log(`Конфиг с GitHub загружен: модов ${((remote.mods || []).length)}, neoforge ${remote.neoforgeVersion}`);
    return remote;
  } catch (err) {
    log(`Не удалось получить актуальный config.json (${err.message}), использую сохранённую копию`);
    try {
      const cached = JSON.parse(fs.readFileSync(CONFIG_CACHE_PATH, "utf-8"));
      log(`Используется закэшированный конфиг: модов ${((cached.mods || []).length)}`);
      return cached;
    } catch {
      const bundled = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      log(`Используется вшитый в лаунчер конфиг: модов ${((bundled.mods || []).length)}`);
      return bundled;
    }
  }
}

// ---------- проверка: нужно ли вообще что-то качать ----------
ipcMain.handle("check-status", async () => {
  const cfg = await loadConfig();
  const mcDir = getMcDir();

  const ver = cfg.neoforgeVersion;
  const installerPath = path.join(mcDir, "installers", `neoforge-${ver}-installer.jar`);
  const installerReady = fs.existsSync(installerPath);

  const modsDir = path.join(mcDir, "mods");
  const allModsPresent = (cfg.mods || []).every((m) => fs.existsSync(path.join(modsDir, m.name)));

  return { needsInstall: !(installerReady && allModsPresent) };
});

// ---------- скачивание файла по URL ----------
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return resolve(downloadFile(res.headers.location, destPath));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Не удалось скачать ${url}: HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
  });
}

// ---------- моды ----------
async function syncMods(mcDir, cfg, from, to) {
  const modsDir = path.join(mcDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });

  const mods = cfg.mods || [];
  const span = to - from;
  const expectedNames = new Set(mods.map((m) => m.name));

  // убираем моды, которых больше нет в актуальном списке (например, убрали из сборки)
  for (const file of fs.readdirSync(modsDir)) {
    if (!expectedNames.has(file)) {
      fs.unlinkSync(path.join(modsDir, file));
      log(`Удалён устаревший мод: ${file}`);
    }
  }

  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    const dest = path.join(modsDir, mod.name);
    if (!fs.existsSync(dest)) {
      await downloadFile(mod.url, dest);
    }
    const percent = mods.length ? from + span * ((i + 1) / mods.length) : to;
    sendProgress(percent, `Моды: ${i + 1}/${mods.length}`);
  }
}

// ---------- servers.dat ----------
async function writeServersDat(mcDir, cfg) {
  const nbt = require("prismarine-nbt");
  const dest = path.join(mcDir, "servers.dat");
  if (fs.existsSync(dest)) return;

  const value = {
    type: "compound",
    name: "",
    value: {
      servers: {
        type: "list",
        value: {
          type: "compound",
          value: [
            {
              name: { type: "string", value: cfg.server.name },
              ip: { type: "string", value: cfg.server.ip },
              acceptTextures: { type: "byte", value: 1 },
            },
          ],
        },
      },
    },
  };

  const buffer = nbt.writeUncompressed(value);
  fs.mkdirSync(mcDir, { recursive: true });
  fs.writeFileSync(dest, buffer);
}

// ---------- NeoForge: только качаем инсталлер, ставит его mclc сам при запуске ----------
async function ensureInstallerDownloaded(mcDir, cfg, from, to) {
  const ver = cfg.neoforgeVersion;
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`;
  const installerPath = path.join(mcDir, "installers", `neoforge-${ver}-installer.jar`);

  if (!fs.existsSync(installerPath)) {
    sendProgress(from, "Скачиваю NeoForge...");
    await downloadFile(url, installerPath);
  }
  sendProgress(to, "NeoForge готов");
  return installerPath;
}

// ---------- авторизация Microsoft через msmc ----------
async function doAuthenticate() {
  const { Auth } = require("msmc");
  const authManager = new Auth("select_account");
  const xboxManager = await authManager.launch("electron");
  const token = await xboxManager.getMinecraft();
  return token.mclc();
}

ipcMain.handle("login", async () => {
  try {
    cachedAuth = await doAuthenticate();
    return { ok: true, name: cachedAuth.name };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// офлайн-вход по нику - удобно для тестов, чтобы не логиниться через Microsoft каждый раз
function offlineUuid(name) {
  const hash = require("crypto").createHash("md5").update("OfflinePlayer:" + name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

ipcMain.handle("login-offline", (_event, name) => {
  const clean = String(name || "").trim();
  if (!clean) return { ok: false, error: "Пустой ник" };
  cachedAuth = {
    access_token: "0",
    client_token: "0",
    uuid: offlineUuid(clean),
    name: clean,
    user_properties: "{}",
    meta: { type: "mojang", demoUser: false },
  };
  return { ok: true, name: clean };
});

ipcMain.handle("logout", () => {
  cachedAuth = null;
  return { ok: true };
});

ipcMain.handle("get-account", () => {
  return cachedAuth ? { name: cachedAuth.name } : null;
});

// ---------- установка (без входа в аккаунт) ----------
ipcMain.handle("install", async () => {
  try {
    const cfg = await loadConfig();
    const mcDir = getMcDir();
    fs.mkdirSync(mcDir, { recursive: true });

    sendProgress(2, "Готовлю сервер...");
    await writeServersDat(mcDir, cfg);

    sendProgress(3, "Проверяю Java...");
    await ensureJavaVersion(cfg);

    ensureLauncherProfiles(mcDir);

    // Веса этапов: NeoForge installer 3-20%, моды 20-100%
    // Саму установку NeoForge (запуск инсталлятора и сборку версии) на этом этапе
    // не делаем - её возьмёт на себя minecraft-launcher-core при первом запуске игры
    // (через opts.forge), у него это получается надёжнее ручной сборки.
    await ensureInstallerDownloaded(mcDir, cfg, 3, 20);
    await syncMods(mcDir, cfg, 20, 100);

    sendProgress(100, "Установка завершена");
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    log(`Ошибка: ${msg}`);
    return { ok: false, error: msg };
  }
});

// ---------- запуск игры (требует входа; сам ставит NeoForge при первом запуске) ----------
ipcMain.handle("play", async () => {
  try {
    const cfg = await loadConfig();
    const mcDir = getMcDir();

    if (!cachedAuth) {
      sendProgress(0, "Вход через Microsoft...");
      cachedAuth = await doAuthenticate();
    }

    const javaPath = cfg.javaPath || "java";
    ensureLauncherProfiles(mcDir);

    const settings = loadSettings();
    const ramMaxMb =
      settings.ramMaxMb ||
      (() => {
        const raw = (cfg.ram && cfg.ram.max) || "4096M";
        const match = raw.match(/^(\d+)([GgMm])$/);
        if (!match) return 4096;
        const num = parseInt(match[1], 10);
        return /[Gg]/.test(match[2]) ? num * 1024 : num;
      })();

    const installerPath = path.join(
      mcDir,
      "installers",
      `neoforge-${cfg.neoforgeVersion}-installer.jar`
    );

    const opts = {
      authorization: cachedAuth,
      root: mcDir,
      javaPath,
      version: {
        number: cfg.minecraftVersion,
        type: "release",
      },
      memory: {
        min: (cfg.ram && cfg.ram.min) || "2048M",
        max: `${ramMaxMb}M`,
      },
      forge: installerPath,
    };

    launcher.removeAllListeners("progress");
    launcher.removeAllListeners("data");
    launcher.removeAllListeners("debug");
    launcher.removeAllListeners("close");

    launcher.on("debug", (e) => log(`[debug] ${e}`));
    launcher.on("data", (e) => log(e.toString()));
    launcher.on("progress", (e) => {
      const frac = e.total ? e.task / e.total : 0;
      sendProgress(frac * 100, `Загрузка: ${e.type}`);
    });
    launcher.on("close", () => {
      gameProcess = null;
      if (mainWindow) mainWindow.webContents.send("game-closed");
    });

    sendProgress(0, "Запускаю игру (первый раз может ставиться NeoForge, это подольше)...");
    gameProcess = await launcher.launch(opts);
    sendProgress(100, "Игра запущена");
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    log(`Ошибка: ${msg}`);
    return { ok: false, error: msg };
  }
});
