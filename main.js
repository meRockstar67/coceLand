const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { Client } = require("minecraft-launcher-core");
const { Auth } = require("msmc");
const { autoUpdater } = require("electron-updater");

const CONFIG_PATH = path.join(__dirname, "config.json");
// Папка с самой игрой (клиент, моды, сохранения, servers.dat) — рядом с лаунчером.
// Можно вынести в app.getPath('userData'), если нужно писать не рядом с exe.
const MC_DIR = path.join(app.getPath("userData"), "gamedata");

let mainWindow;
let launcher = new Client();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    resizable: false,
    autoHideMenuBar: true,
    title: "coceLand",
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
  // Проверяем обновления через пару секунд после старта, чтобы окно успело отрисоваться.
  setTimeout(() => autoUpdater.checkForUpdates(), 2000);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- автообновление (electron-updater, тянет релизы с GitHub) ----------
autoUpdater.on("checking-for-update", () => log("Проверяю обновления..."));
autoUpdater.on("update-not-available", () => log("Установлена последняя версия."));
autoUpdater.on("update-available", (info) =>
  log(`Найдено обновление ${info.version}, скачиваю...`)
);
autoUpdater.on("download-progress", (p) =>
  log(`Скачивание обновления: ${Math.round(p.percent)}%`)
);
autoUpdater.on("error", (err) => log(`Ошибка автообновления: ${err.message}`));
autoUpdater.on("update-downloaded", () => {
  log("Обновление скачано. Перезапусти лаунчер, чтобы применить.");
  if (mainWindow) mainWindow.webContents.send("update-ready");
});

ipcMain.handle("install-update", () => {
  autoUpdater.quitAndInstall();
});

function log(msg) {
  console.log(msg);
  if (mainWindow) mainWindow.webContents.send("log", msg);
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

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

// ---------- моды: скачиваем всё, чего ещё нет в /mods ----------
async function syncMods(cfg) {
  const modsDir = path.join(MC_DIR, "mods");
  fs.mkdirSync(modsDir, { recursive: true });

  for (const mod of cfg.mods || []) {
    const dest = path.join(modsDir, mod.name);
    if (fs.existsSync(dest)) {
      log(`Мод уже скачан: ${mod.name}`);
      continue;
    }
    log(`Скачиваю мод: ${mod.name}...`);
    await downloadFile(mod.url, dest);
    log(`Готово: ${mod.name}`);
  }
}

// ---------- servers.dat: подставляем сервер по умолчанию ----------
async function writeServersDat(cfg) {
  const nbt = require("prismarine-nbt");
  const dest = path.join(MC_DIR, "servers.dat");

  // Если файл уже существует - не перетираем (чтобы не сбрасывать список у игрока),
  // если нужно принудительно обновлять - удали эту проверку.
  if (fs.existsSync(dest)) {
    log("servers.dat уже существует, пропускаю создание.");
    return;
  }

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
  fs.mkdirSync(MC_DIR, { recursive: true });
  fs.writeFileSync(dest, buffer);
  log(`servers.dat создан, сервер по умолчанию: ${cfg.server.name} (${cfg.server.ip})`);
}

// ---------- NeoForge: скачиваем инсталлер, mclc сам его прогонит ----------
async function getNeoForgeInstallerPath(cfg) {
  if (cfg.modLoader !== "neoforge") return null;

  const ver = cfg.neoforgeVersion;
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`;
  const dest = path.join(MC_DIR, "installers", `neoforge-${ver}-installer.jar`);

  if (!fs.existsSync(dest)) {
    log(`Скачиваю NeoForge installer (${ver})...`);
    await downloadFile(url, dest);
  } else {
    log("NeoForge installer уже скачан.");
  }
  return dest;
}

// ---------- авторизация Microsoft через msmc ----------
async function authenticate() {
  const authManager = new Auth("select_account");
  // "electron" открывает встроенное окно логина Microsoft внутри лаунчера
  const xboxManager = await authManager.launch("electron");
  const token = await xboxManager.getMinecraft();
  return token.mclc(); // формат, который понимает minecraft-launcher-core
}

// ---------- основной флоу запуска ----------
ipcMain.handle("launch", async () => {
  try {
    const cfg = loadConfig();
    fs.mkdirSync(MC_DIR, { recursive: true });

    log("Авторизация Microsoft...");
    const authorization = await authenticate();
    log(`Вошли как: ${authorization.name}`);

    await writeServersDat(cfg);
    await syncMods(cfg);

    const forgeInstaller = await getNeoForgeInstallerPath(cfg);

    const opts = {
      authorization,
      root: MC_DIR,
      version: {
        number: cfg.minecraftVersion,
        type: "release",
      },
      memory: {
        min: cfg.ram.min,
        max: cfg.ram.max,
      },
      // mclc сам запустит forge/neoforge installer и подменит версию запуска
      forge: forgeInstaller || undefined,
    };

    launcher.on("debug", (e) => log(`[debug] ${e}`));
    launcher.on("data", (e) => log(e.toString()));
    launcher.on("progress", (e) =>
      log(`Загрузка: ${e.type} ${e.task}/${e.total}`)
    );

    log("Запускаю игру...");
    await launcher.launch(opts);
    log("Игра запущена.");
    return { ok: true };
  } catch (err) {
    log(`Ошибка: ${err.message}`);
    return { ok: false, error: err.message };
  }
});
