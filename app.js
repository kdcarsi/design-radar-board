const GATE_KEY = "radar-gate-ok";
const GATE_HASH = "17c7c89093b7e4b3942c317e272399bb7eaa5a63bde081e262d2172525b7de7b";
const STORE = "design-radar-board-v1";
const ARCHIVE = "design-radar-days-v1";

const state = {
  todayDate: null,
  date: null,
  picks: [],
  board: [],
  days: {},
  tab: "radar",
};

const els = {
  tabRadar: document.getElementById("tab-radar"),
  tabProfile: document.getElementById("tab-profile"),
  radarView: document.getElementById("radar-view"),
  profileView: document.getElementById("profile-view"),
  dateLabel: document.getElementById("date-label"),
  keptLabel: document.getElementById("kept-label"),
  days: document.getElementById("days"),
  todayTitle: document.getElementById("today-title"),
  today: document.getElementById("today"),
  todayEmpty: document.getElementById("today-empty"),
  board: document.getElementById("board"),
  boardEmpty: document.getElementById("board-empty"),
  toast: document.getElementById("toast"),
  toastMsg: document.getElementById("toast-msg"),
  undo: document.getElementById("undo"),
  pop: document.getElementById("pop"),
};

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const WEEKDAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
let toastTimer = 0;
let popTimer = 0;
let pulseId = null;
let lastDropped = null;

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function showGate() {
  const gate = document.getElementById("gate");
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-key");
  if (!gate || !form || !input) return;
  gate.hidden = false;
  document.body.style.overflow = "hidden";
  input.value = "";
  setTimeout(() => input.focus(), 40);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const hex = await sha256hex(input.value);
    if (hex !== GATE_HASH) {
      form.classList.add("bad");
      input.value = "";
      setTimeout(() => form.classList.remove("bad"), 180);
      return;
    }
    localStorage.setItem(GATE_KEY, "1");
    gate.hidden = true;
    document.body.style.overflow = "";
    boot();
  });
}

function locked() {
  return !localStorage.getItem(GATE_KEY);
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function last7(iso) {
  const anchor = parseISO(iso);
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const dt = new Date(anchor);
    dt.setUTCDate(anchor.getUTCDate() - i);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

function formatHeaderDate(iso) {
  const dt = parseISO(iso);
  return `${String(dt.getUTCDate()).padStart(2, "0")} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

function sourceOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function whisper(item) {
  const handle = item.handle ? `@${item.handle}` : "";
  const source = sourceOf(item.url || "");
  return [handle, source].filter(Boolean).join(" · ");
}

function keptIds() {
  return new Set(state.board.map((item) => item.id));
}

function extIcon() {
  return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M3 2h6v6M9 2L2 9" stroke="currentColor" stroke-width="1.1"/></svg>`;
}

function loadLocal() {
  try {
    const board = JSON.parse(localStorage.getItem(STORE) || "[]");
    state.board = Array.isArray(board) ? board : [];
  } catch { state.board = []; }
  try {
    const days = JSON.parse(localStorage.getItem(ARCHIVE) || "{}");
    state.days = days && typeof days === "object" ? days : {};
  } catch { state.days = {}; }
}

function saveLocal() {
  localStorage.setItem(STORE, JSON.stringify(state.board));
  localStorage.setItem(ARCHIVE, JSON.stringify(state.days));
}

function purgeExpired() {
  if (!state.todayDate) return;
  const live = new Set(last7(state.todayDate));
  Object.keys(state.days).forEach((iso) => {
    if (!live.has(iso)) delete state.days[iso];
  });
  if (state.date && !live.has(state.date)) {
    state.date = state.todayDate;
    state.picks = state.days[state.todayDate] || [];
  }
}

function setTab(tab) {
  state.tab = tab === "profile" ? "profile" : "radar";
  const onProfile = state.tab === "profile";
  els.tabRadar.classList.toggle("on", !onProfile);
  els.tabProfile.classList.toggle("on", onProfile);
  els.radarView.hidden = onProfile;
  els.profileView.hidden = !onProfile;
}

function renderHeader() {
  els.dateLabel.textContent = formatHeaderDate(state.todayDate || state.date);
  const n = state.board.length;
  els.keptLabel.textContent = n === 1 ? "1 kept" : `${n} kept`;
}

function renderDays() {
  els.days.innerHTML = "";
  last7(state.todayDate).forEach((iso) => {
    const dt = parseISO(iso);
    const btn = document.createElement("button");
    btn.type = "button";
    if (iso === state.date) btn.classList.add("on");
    if ((state.days[iso] || []).length) btn.classList.add("has");
    btn.innerHTML = `<span>${WEEKDAYS[dt.getUTCDay()]}</span><span>${dt.getUTCDate()}</span>`;
    btn.addEventListener("click", () => selectDay(iso));
    els.days.appendChild(btn);
  });
}

function renderToday() {
  const kept = keptIds();
  const picks = (state.picks || []).filter((p) => p.image);
  els.today.innerHTML = "";
  els.todayTitle.textContent = state.date === state.todayDate ? "TODAY" : formatHeaderDate(state.date).slice(0, 6).trim();
  if (!picks.length) {
    els.today.hidden = true;
    els.todayEmpty.hidden = false;
    return;
  }
  els.today.hidden = false;
  els.todayEmpty.hidden = true;
  picks.forEach((pick) => {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    if (kept.has(pick.id)) card.classList.add("kept");
    if (pulseId === pick.id) card.classList.add("pulse");
    const href = pick.url || "";
    card.innerHTML = `
      <div class="frame">
        <img src="${pick.image}" alt="" draggable="false">
        ${href ? `<a class="ext" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Open source">${extIcon()}</a>` : ""}
      </div>
      <p class="whisper">${whisper(pick)}</p>`;
    card.addEventListener("click", (e) => { if (!e.target.closest(".ext")) toggleKeep(pick.id); });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleKeep(pick.id); }
    });
    card.querySelector("img").addEventListener("error", () => card.remove());
    els.today.appendChild(card);
  });
}

function renderBoard() {
  els.board.innerHTML = "";
  if (!state.board.length) {
    els.board.hidden = true;
    els.boardEmpty.hidden = false;
    return;
  }
  els.board.hidden = false;
  els.boardEmpty.hidden = true;
  state.board.forEach((item) => {
    if (!item.image) return;
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    if (pulseId === item.id) card.classList.add("pulse");
    card.innerHTML = `
      <div class="frame">
        <img src="${item.image}" alt="" draggable="false">
        <button type="button" class="drop" aria-label="Remove">×</button>
      </div>
      <p class="whisper">${whisper(item)}</p>`;
    card.querySelector(".drop").addEventListener("click", (e) => { e.stopPropagation(); dropItem(item.id); });
    els.board.appendChild(card);
  });
}

function render() {
  renderHeader();
  renderDays();
  renderToday();
  renderBoard();
  setTab(state.tab);
}

function selectDay(iso) {
  const live = new Set(last7(state.todayDate));
  if (!live.has(iso)) return;
  state.date = iso;
  state.picks = state.days[iso] || [];
  setTab("radar");
  render();
}

function findPick(id) {
  for (const list of Object.values(state.days)) {
    const hit = (list || []).find((p) => p.id === id);
    if (hit) return hit;
  }
  return state.board.find((p) => p.id === id) || null;
}

function toggleKeep(id) {
  const idx = state.board.findIndex((p) => p.id === id);
  if (idx >= 0) {
    lastDropped = state.board[idx];
    state.board.splice(idx, 1);
    pulseId = null;
    showPop("REMOVED");
  } else {
    const pick = findPick(id);
    if (!pick || !pick.image) return;
    state.board.unshift({
      id: pick.id,
      handle: pick.handle,
      url: pick.url,
      post_date: pick.post_date,
      day: pick.day || state.date,
      image: pick.image,
      picked_at: new Date().toISOString(),
    });
    pulseId = id;
    lastDropped = null;
    showPop("ADDED");
    window.setTimeout(() => {
      if (pulseId === id) {
        pulseId = null;
        document.querySelectorAll(".pulse").forEach((n) => n.classList.remove("pulse"));
      }
    }, 140);
  }
  saveLocal();
  render();
}

function dropItem(id) {
  const idx = state.board.findIndex((p) => p.id === id);
  if (idx < 0) return;
  lastDropped = state.board[idx];
  state.board.splice(idx, 1);
  saveLocal();
  render();
  showPop("REMOVED");
  showToast("Removed.", true);
}

function restore() {
  if (!lastDropped) return;
  if (!state.board.some((p) => p.id === lastDropped.id)) state.board.unshift(lastDropped);
  lastDropped = null;
  saveLocal();
  hideToast();
  render();
}

function showPop(text) {
  if (!els.pop) return;
  els.pop.textContent = text || "ADDED";
  els.pop.hidden = false;
  window.clearTimeout(popTimer);
  popTimer = window.setTimeout(() => { els.pop.hidden = true; }, 1400);
}

function showToast(message, withUndo) {
  if (els.toastMsg) els.toastMsg.textContent = message || "Removed.";
  if (els.undo) els.undo.hidden = !withUndo;
  els.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, withUndo ? 3000 : 1600);
}

function hideToast() {
  els.toast.hidden = true;
  window.clearTimeout(toastTimer);
}

els.undo.addEventListener("click", restore);
els.tabRadar.addEventListener("click", () => { setTab("radar"); });
els.tabProfile.addEventListener("click", () => { setTab("profile"); });
els.keptLabel.addEventListener("click", () => { setTab("profile"); });

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const t = event.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (state.tab !== "radar") return;
  if (event.key < "0" || event.key > "9") return;
  const index = event.key === "0" ? 9 : Number(event.key) - 1;
  const pick = (state.picks || []).filter((p) => p.image)[index];
  if (pick) toggleKeep(pick.id);
});

async function boot() {
  loadLocal();
  const res = await fetch(`today.json?t=${Date.now()}`, { cache: "no-store" });
  const today = await res.json();
  state.todayDate = today.date;
  state.date = today.date;
  state.picks = (today.picks || []).filter((p) => p.image);
  state.days[today.date] = state.picks;
  purgeExpired();
  saveLocal();
  render();
}

if (locked()) showGate(); else boot();
