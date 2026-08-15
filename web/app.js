import {
  MODES,
  createGame,
  discoverClue,
  joinSeat,
  recordPlayerEvent,
  setSeatReady,
  startGame,
  viewForSeat
} from "../shared/escape-core.mjs";

const STORAGE_KEY = "atherloom:escape:local-game:v1";
const ADULT_KEY = "atherloom:escape:adult-confirmed:v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let state = loadState();
let activeSeatId = state?.seats?.[0]?.id || null;
let toastTimer = null;

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

function saveState(message = "本机即时存档完成") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $("#globalStatus").textContent = message;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function currentMode() {
  return new FormData($("#createForm")).get("mode") || "duo";
}

function archiveNumber() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
}

function friendlyEvent(event) {
  const actor = state.seats.find((seat) => seat.id === event.actorSeatId)?.displayName || "裁判";
  if (event.type === "game.created") return `<b>裁判</b> 抽出了 ${event.data.theme.world} × ${event.data.theme.tone}`;
  if (event.type === "seat.joined") return `<b>${escapeHtml(event.data.displayName)}</b> 从 ${escapeHtml(event.data.platform)} 入席`;
  if (event.type === "seat.ready") return `<b>${escapeHtml(actor)}</b> ${event.data.ready ? "准备好了" : "暂时取消准备"}`;
  if (event.type === "game.started") return `<b>裁判</b> 打开了房间，第一轮开始`;
  if (event.type === "turn.assigned") return `<b>裁判</b> 将行动交给 ${escapeHtml(state.seats.find((seat) => seat.id === event.data.seatId)?.displayName || "未知席位")}`;
  if (event.type === "player.said") return `<b>${escapeHtml(actor)}</b>：${escapeHtml(event.data.content || "")}`;
  if (event.type === "player.observed") return `<b>${escapeHtml(actor)}</b> 查看了“${escapeHtml(event.data.target || "现场")}"`;
  if (event.type === "clue.discovered") return `<b>新线索</b> ${escapeHtml(event.data.title || "未命名证物")}`;
  return `<b>${escapeHtml(actor)}</b> 更新了现场`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function renderLanding() {
  $("#landingView").hidden = false;
  $("#roomView").hidden = true;
  $("#archiveNumber").textContent = archiveNumber();
  $("#worldPreview").textContent = "世界待抽取";
  $("#tonePreview").textContent = "气质待抽取";
  $("#resumeGame").hidden = !state;
}

function renderRoom() {
  if (!state || !activeSeatId) return renderLanding();
  const view = viewForSeat(state, activeSeatId);
  $("#landingView").hidden = true;
  $("#roomView").hidden = false;
  $("#caseId").textContent = state.id.slice(-10).toUpperCase();
  $("#caseTitle").textContent = `${view.theme.world}现场 · ${view.theme.tone}路线`;
  $("#roomWorld").textContent = view.theme.world;
  $("#roomTone").textContent = view.theme.tone;
  $("#seatCount").textContent = `${view.seats.length} / ${MODES[view.mode].maxSeats}`;
  $("#roomInvite").textContent = state.inviteCode || "LOCAL-DEMO";
  $("#roundNumber").textContent = view.round;
  $("#stateVersion").textContent = view.version;
  $("#eventCursor").textContent = view.eventCursor;
  $("#clueCount").textContent = `${view.clues.length} 件`;
  $("#mapProgress").textContent = `${Math.min(18 + view.clues.length * 14, 94)}%`;

  const current = view.seats.find((seat) => seat.id === view.currentSeatId);
  $("#turnOwner").textContent = view.status === "lobby" ? "等待所有人准备" : `${current?.displayName || "裁判"} 正在行动`;
  $("#sceneDescription").textContent = view.status === "lobby"
    ? "档案已经建立，但真正的房间要等所有席位到齐后才会打开。此刻只有一张未完成的平面图，以及各自不同的视线。"
    : "入口室的灯管发出轻微电流声。墙上的钟停在 02:17，玻璃后的线路图缺了一站，而门禁屏幕只显示一行：请由下一位观察者确认。";

  const missing = Math.max(0, MODES[view.mode].minSeats - view.seats.length);
  $("#seatList").innerHTML = view.seats.map((seat) => `
    <div class="seat">
      <span class="seat__mark">${escapeHtml(seat.displayName.slice(0, 1))}</span>
      <span><b>${escapeHtml(seat.displayName)}</b><small>${seat.kind === "ai" ? "AI" : "人类"} · ${escapeHtml(seat.platform)} · ${seat.ready ? "已准备" : "未准备"}</small></span>
    </div>`).join("") + Array.from({ length: missing }, () => `<div class="seat seat--empty"><span class="seat__mark">＋</span><span><b>等待同伴</b><small>用邀请码从其他平台入席</small></span></div>`).join("");

  $("#eventStream").innerHTML = view.events.slice(-10).reverse().map((event) => `<div class="event-entry" data-seq="${event.seq}">${friendlyEvent(event)}</div>`).join("");
  $("#evidenceList").innerHTML = view.clues.length ? view.clues.map((clue, index) => `
    <article class="evidence-card"><small>EVIDENCE ${String(index + 1).padStart(2, "0")}</small><b>${escapeHtml(clue.title)}</b><p>${escapeHtml(clue.summary || "这条线索暂时没有进一步说明。")}</p></article>`).join("")
    : `<div class="empty-evidence"><i></i><p>先观察房间。只有真正发现的线索才会出现在这里。</p></div>`;
}

function prepareLocalCompanion() {
  const mode = state.mode;
  if (mode === "duo") joinSeat(state, { id: makeId("seat"), kind: "ai", displayName: "本机演示同伴", platform: "demo（非真实 AI）" });
  if (mode === "ai_party" || mode === "mixed_party") joinSeat(state, { id: makeId("seat"), kind: "ai", displayName: "本机演示同伴", platform: "demo（非真实 AI）" });
}

function beginDemoIfPossible() {
  state.seats.forEach((seat) => setSeatReady(state, seat.id, true));
  if (state.seats.length >= MODES[state.mode].minSeats) startGame(state, activeSeatId);
}

$("#createForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const mode = currentMode();
  const displayName = $("#displayName").value.trim() || (mode === "ai_solo" || mode === "ai_party" ? "当前人格" : "玩家");
  const id = makeId("game");
  const creatorKind = mode === "ai_solo" || mode === "ai_party" ? "ai" : "human";
  activeSeatId = makeId("seat");
  state = createGame({ id, seed: crypto.getRandomValues(new Uint32Array(1))[0], mode, creator: { id: activeSeatId, kind: creatorKind, displayName, platform: "web" } });
  state.inviteCode = randomCode();
  prepareLocalCompanion();
  beginDemoIfPossible();
  saveState("本机演示已建立并即时存档");
  $("#worldPreview").textContent = state.theme.world;
  $("#tonePreview").textContent = state.theme.tone;
  renderRoom();
  toast(`抽中：${state.theme.world} × ${state.theme.tone}`);
});

$("#observeAction").addEventListener("click", () => {
  const target = $("#actionInput").value.trim();
  if (!target) return toast("先写下你想观察的地方或物品");
  try {
    recordPlayerEvent(state, { seatId: activeSeatId, type: "player.observed", requestId: crypto.randomUUID(), data: { target } });
    const clueNumber = state.publicClues.length + 1;
    discoverClue(state, {
      clueId: `local-${clueNumber}`,
      title: clueNumber === 1 ? "停在 02:17 的钟" : `关于“${target.slice(0, 12)}”的痕迹`,
      summary: clueNumber === 1 ? "秒针没有损坏。有人主动切断了它与站内时间服务器的同步。" : "这条本机演示线索已由裁判写入即时存档。",
      actorSeatId: activeSeatId
    });
    $("#actionInput").value = "";
    saveState();
    renderRoom();
    toast("观察结果已写入存档");
  } catch (error) {
    toast(error.message === "not_your_turn" ? "现在轮到另一位玩家；联机后由对方完成动作" : "这一步暂时不能执行");
  }
});

$("#speakAction").addEventListener("click", () => {
  const content = $("#actionInput").value.trim();
  if (!content) return toast("先写下想告诉同伴的话");
  recordPlayerEvent(state, { seatId: activeSeatId, type: "player.said", requestId: crypto.randomUUID(), data: { content } });
  $("#actionInput").value = "";
  saveState();
  renderRoom();
});

$("#showJoin").addEventListener("click", () => { $("#joinForm").hidden = false; $("#inviteCode").focus(); });
$("#hideJoin").addEventListener("click", () => { $("#joinForm").hidden = true; });
$("#joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("#inviteCode").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}-?[A-Z2-9]{4}$/.test(code)) return toast("邀请码格式不正确");
  toast("Relay 尚未部署，没有伪造入席；邀请码已通过格式检查");
});

$("#copyInvite").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(state.inviteCode); toast("邀请码已复制"); }
  catch { toast(`邀请码：${state.inviteCode}`); }
});

$("#backHome").addEventListener("click", renderLanding);
$("#resumeGame").addEventListener("click", renderRoom);
$(".brand").addEventListener("click", (event) => { event.preventDefault(); renderLanding(); });
$$('.mobile-tabs button').forEach((button) => button.addEventListener("click", () => {
  $$('.mobile-tabs button').forEach((item) => item.classList.toggle("active", item === button));
  $$('[data-mobile-panel]').forEach((panel) => panel.classList.toggle("mobile-active", panel.dataset.mobilePanel === button.dataset.panel));
}));

$("#confirmAdult").addEventListener("click", () => {
  sessionStorage.setItem(ADULT_KEY, "yes");
  $("#ageGate").hidden = true;
});
$("#declineAdult").addEventListener("click", () => {
  $("#ageGate").hidden = true;
  $("#appShell").hidden = true;
  $("#blockedScreen").hidden = false;
});

if (!sessionStorage.getItem(ADULT_KEY)) $("#ageGate").hidden = false;
$("#archiveNumber").textContent = archiveNumber();
if (state) {
  activeSeatId = state.seats[0].id;
  $("#globalStatus").textContent = "找到一份本机即时存档";
}
renderLanding();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
