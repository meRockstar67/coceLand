const playBtn = document.getElementById("playBtn");
const statusEl = document.getElementById("status");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");

const accountBtn = document.getElementById("accountBtn");
const accountAvatar = document.getElementById("accountAvatar");
const accountLabel = document.getElementById("accountLabel");

const accountOverlay = document.getElementById("accountOverlay");
const accountClose = document.getElementById("accountClose");
const accountLoggedOut = document.getElementById("accountLoggedOut");
const accountLoggedIn = document.getElementById("accountLoggedIn");
const nicknameInput = document.getElementById("nicknameInput");
const nicknameSubmit = document.getElementById("nicknameSubmit");
const msLoginBtn = document.getElementById("msLoginBtn");
const loggedInName = document.getElementById("loggedInName");
const logoutBtn = document.getElementById("logoutBtn");

const logsBtn = document.getElementById("logsBtn");
const logsOverlay = document.getElementById("logsOverlay");
const logsClose = document.getElementById("logsClose");
const logsBox = document.getElementById("logsBox");

const updateIconBtn = document.getElementById("updateIconBtn");

const settingsBtn = document.getElementById("settingsBtn");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsClose = document.getElementById("settingsClose");
const settingsFolderPath = document.getElementById("settingsFolderPath");
const settingsFolderBtn = document.getElementById("settingsFolderBtn");
const ramSlider = document.getElementById("ramSlider");
const ramValueLabel = document.getElementById("ramValueLabel");

// btnState: "install" | "play" | "update" | "running"
let btnState = "install";
let busy = false;

function renderButton() {
  settingsBtn.disabled = busy;
  if (busy) {
    playBtn.disabled = true;
    return;
  }
  playBtn.disabled = false;
  playBtn.classList.remove("update", "danger");

  if (btnState === "update") {
    playBtn.textContent = "ОБНОВИТЬ";
    playBtn.classList.add("update");
  } else if (btnState === "running") {
    playBtn.textContent = "ЗАКРЫТЬ";
    playBtn.classList.add("danger");
  } else if (btnState === "play") {
    playBtn.textContent = "ИГРАТЬ";
  } else {
    playBtn.textContent = "УСТАНОВИТЬ";
  }
}

function setBusy(isBusy) {
  busy = isBusy;
  renderButton();
  progressWrap.hidden = !isBusy;
  if (isBusy) {
    progressWrap.style.width = playBtn.offsetWidth + "px";
  } else {
    progressFill.style.width = "0%";
    progressLabel.textContent = "0%";
  }
}

async function refreshStatus() {
  try {
    const { needsInstall } = await window.coceland.checkStatus();
    btnState = needsInstall ? "install" : "play";
  } catch {
    btnState = "install";
  }
  renderButton();
}

async function refreshAccount() {
  const account = await window.coceland.getAccount();
  if (account) {
    accountLabel.textContent = account.name;
    accountAvatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(account.name)}/64`;
  } else {
    accountLabel.textContent = "Войти";
    accountAvatar.src = "https://mc-heads.net/avatar/MHF_Steve/64";
  }
}

async function refreshFolder() {
  const dir = await window.coceland.getInstallDir();
  settingsFolderPath.textContent = dir;
}

async function refreshRam() {
  const mb = await window.coceland.getRam();
  ramSlider.value = mb;
  ramValueLabel.textContent = mb + " МБ";
}

function openSettings() {
  settingsOverlay.hidden = false;
}

function closeSettings() {
  settingsOverlay.hidden = true;
}

const logLines = [];

window.coceland.onLog((msg) => {
  logLines.push(msg);
  if (logLines.length > 2000) logLines.shift(); // не даём разрастись бесконечно
  if (!logsOverlay.hidden) renderLogs();
});

function renderLogs() {
  logsBox.innerHTML = "";
  for (const line of logLines) {
    const div = document.createElement("div");
    div.textContent = line;
    logsBox.appendChild(div);
  }
  logsBox.scrollTop = logsBox.scrollHeight;
}

function openLogs() {
  renderLogs();
  logsOverlay.hidden = false;
}

function closeLogs() {
  logsOverlay.hidden = true;
}

window.coceland.onProgress(({ percent, label }) => {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  progressFill.style.width = p + "%";
  progressLabel.textContent = `${p}% — ${label}`;
});

window.coceland.onUpdateReady(() => {
  btnState = "update";
  updateIconBtn.hidden = false;
  renderButton();
});

updateIconBtn.addEventListener("click", () => {
  window.coceland.installUpdate();
});

window.coceland.onGameClosed(() => {
  btnState = "play";
  statusEl.textContent = "";
  renderButton();
});

async function openAccountModal() {
  const account = await window.coceland.getAccount();
  if (account) {
    accountLoggedIn.hidden = false;
    accountLoggedOut.hidden = true;
    loggedInName.textContent = account.name;
  } else {
    accountLoggedIn.hidden = true;
    accountLoggedOut.hidden = false;
    nicknameInput.value = "";
  }
  accountOverlay.hidden = false;
}

function closeAccountModal() {
  accountOverlay.hidden = true;
}

accountBtn.addEventListener("click", () => {
  if (busy) return;
  openAccountModal();
});

accountClose.addEventListener("click", closeAccountModal);

nicknameSubmit.addEventListener("click", async () => {
  const result = await window.coceland.loginOffline(nicknameInput.value);
  if (result.ok) {
    await refreshAccount();
    closeAccountModal();
  } else {
    statusEl.textContent = "Ошибка: " + result.error;
  }
});

nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nicknameSubmit.click();
});

msLoginBtn.addEventListener("click", async () => {
  msLoginBtn.textContent = "Вход...";
  msLoginBtn.disabled = true;
  const result = await window.coceland.login();
  msLoginBtn.disabled = false;
  msLoginBtn.textContent = "Войти через Microsoft";
  if (result.ok) {
    await refreshAccount();
    closeAccountModal();
  } else {
    statusEl.textContent = "Ошибка входа: " + result.error;
  }
});

logoutBtn.addEventListener("click", async () => {
  await window.coceland.logout();
  await refreshAccount();
  closeAccountModal();
});

logsBtn.addEventListener("click", openLogs);
logsClose.addEventListener("click", closeLogs);

settingsBtn.addEventListener("click", () => {
  if (busy) return;
  openSettings();
});

settingsClose.addEventListener("click", closeSettings);

settingsFolderBtn.addEventListener("click", async () => {
  const result = await window.coceland.chooseInstallDir();
  if (result.ok) {
    await refreshFolder();
    await refreshStatus(); // новая папка - скорее всего снова нужна установка
  }
});

ramSlider.addEventListener("input", () => {
  ramValueLabel.textContent = ramSlider.value + " МБ";
});

ramSlider.addEventListener("change", async () => {
  await window.coceland.setRam(parseInt(ramSlider.value, 10));
});

playBtn.addEventListener("click", async () => {
  if (busy) return;

  if (btnState === "update") {
    window.coceland.installUpdate();
    return;
  }

  if (btnState === "running") {
    await window.coceland.closeGame();
    btnState = "play";
    renderButton();
    return;
  }

  setBusy(true);
  statusEl.textContent = "";

  let result;
  if (btnState === "install") {
    result = await window.coceland.install();
  } else {
    result = await window.coceland.play();
  }

  if (result.ok) {
    statusEl.textContent = "";
    if (btnState === "play") {
      btnState = "running";
    } else {
      await refreshStatus();
    }
  } else {
    statusEl.textContent = "Ошибка: " + result.error;
  }
  setBusy(false);
  await refreshAccount();
});

refreshStatus();
refreshAccount();
refreshFolder();
refreshRam();
