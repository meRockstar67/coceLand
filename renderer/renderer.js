const playBtn = document.getElementById("playBtn");
const updateBtn = document.getElementById("updateBtn");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

window.coceland.onLog((msg) => {
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
});

window.coceland.onUpdateReady(() => {
  playBtn.hidden = true;
  updateBtn.hidden = false;
  statusEl.textContent = "Доступно обновление";
});

updateBtn.addEventListener("click", () => {
  window.coceland.installUpdate();
});

playBtn.addEventListener("click", async () => {
  playBtn.disabled = true;
  statusEl.textContent = "Запуск...";
  logEl.innerHTML = "";

  const result = await window.coceland.launch();

  if (result.ok) {
    statusEl.textContent = "Игра запущена";
  } else {
    statusEl.textContent = "Ошибка: " + result.error;
  }
  playBtn.disabled = false;
});
