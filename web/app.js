import {
  GAME_TYPES,
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
const WORLD_SLUGS = { "古代": "ancient", "现代": "modern", "科幻": "scifi", "近现代": "near-modern", "中世纪": "medieval", "西幻": "fantasy" };
const TONE_SLUGS = { "甜宠": "sweet", "日常": "daily", "正剧": "drama", "BE": "be", "恐怖": "horror" };
const CHARACTER_ROLES = {
  "古代": "持有密令的游侠",
  "现代": "追查异常事件的调查员",
  "科幻": "失去一段航行记录的领航员",
  "近现代": "携带未发电报的访客",
  "中世纪": "受命穿过封锁线的旅人",
  "西幻": "尚未宣誓阵营的术士"
};

let state = loadState();
let activeSeatId = state?.activeSeatId || state?.seats?.[0]?.id || null;
let toastTimer = null;

function normalizeState(candidate) {
  if (!candidate) return null;
  candidate.gameType ||= "escape";
  candidate.referee ||= { displayName: "规则裁判", routeLabel: "本机规则演示", platform: "local-demo" };
  candidate.seats = (candidate.seats || []).map((seat) => ({ role: "player", ...seat }));
  return candidate;
}

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
  try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); } catch { return null; }
}

function saveState(message = "本机即时存档完成") {
  state.activeSeatId = activeSeatId;
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

function formValue(name, fallback = "") {
  return String(new FormData($("#createForm")).get(name) || fallback);
}

function currentMode() { return formValue("mode", "duo"); }
function currentGameType() { return formValue("gameType", "escape"); }

function archiveNumber() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function seatName(seatId) {
  return state.seats.find((seat) => seat.id === seatId)?.displayName || state.referee?.displayName || "裁判";
}

function friendlyEvent(event) {
  const actor = seatName(event.actorSeatId);
  const referee = escapeHtml(state.referee?.displayName || "裁判");
  if (event.type === "game.created") return `<b>${referee}</b> 抽出了 ${event.data.theme.world} × ${event.data.theme.tone}`;
  if (event.type === "seat.joined") return `<b>${escapeHtml(event.data.displayName)}</b> 以${event.data.role === "spectator" ? "观战者" : "玩家"}身份入席`;
  if (event.type === "seat.ready") return `<b>${escapeHtml(actor)}</b> ${event.data.ready ? "准备好了" : "暂时取消准备"}`;
  if (event.type === "game.started") return `<b>${referee}</b> 打开了${state.gameType === "trpg" ? "第一幕" : "房间"}`;
  if (event.type === "turn.assigned") return `<b>${referee}</b> 将行动交给 ${escapeHtml(seatName(event.data.seatId))}`;
  if (event.type === "player.observed") return `<b>${escapeHtml(actor)}</b> 查看了“${escapeHtml(event.data.target || "现场")}”`;
  if (event.type === "player.acted") return `<b>${escapeHtml(actor)}</b>：${escapeHtml(event.data.target || event.data.action || "采取行动")}`;
  if (event.type === "trpg.rolled") return `<b>${escapeHtml(actor)}</b> 掷出 d20：${Number(event.data.roll)} ${event.data.success ? "· 成功" : "· 未通过"}`;
  if (event.type === "clue.discovered") return `<b>${referee}</b> 公开了 ${escapeHtml(event.data.title || "新信息")}`;
  return `<b>${escapeHtml(actor)}</b> 更新了现场`;
}

function applyTheme(view) {
  const root = document.documentElement;
  root.dataset.world = WORLD_SLUGS[view.theme.world] || "modern";
  root.dataset.tone = TONE_SLUGS[view.theme.tone] || "drama";
  root.dataset.game = view.gameType;
  root.dataset.mode = view.mode;
}

function renderLanding() {
  $("#landingView").hidden = false;
  $("#roomView").hidden = true;
  $("#archiveNumber").textContent = archiveNumber();
  $("#worldPreview").textContent = "世界待抽取";
  $("#tonePreview").textContent = "气质待抽取";
  $("#resumeGame").hidden = !state;
}

function renderChat(view) {
  const messages = view.events.filter((event) => event.type === "chat.sent" || event.type === "player.said");
  $("#chatStream").innerHTML = messages.length ? messages.slice(-20).map((event) => `
    <div class="chat-line${event.data.demo ? " chat-line--demo" : ""}">
      <b>${escapeHtml(seatName(event.actorSeatId))}</b><span>${escapeHtml(event.data.content || "")}</span>
    </div>`).join("") : `<p class="chat-empty">频道安静。玩家和观战者都可以在这里说话。</p>`;
}

function renderEvidence(view) {
  if (view.gameType === "trpg") {
    $("#evidenceHeading").textContent = "状态与任务";
    $("#evidenceTab").textContent = "状态";
    $("#clueCount").textContent = `${view.clues.length + 2} 项`;
    const statusCards = [
      { title: "角色状态", summary: "稳定 · 尚未获得持续负面状态" },
      { title: "当前任务", summary: "抵达故事的第一处转折，并判断谁值得信任。" }
    ];
    $("#evidenceList").innerHTML = [...statusCards, ...view.clues].map((item, index) => `
      <article class="evidence-card"><small>RECORD ${String(index + 1).padStart(2, "0")}</small><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.summary)}</p></article>`).join("");
    return;
  }
  $("#evidenceHeading").textContent = "证物与线索";
  $("#evidenceTab").textContent = "线索";
  $("#clueCount").textContent = `${view.clues.length} 件`;
  $("#evidenceList").innerHTML = view.clues.length ? view.clues.map((clue, index) => `
    <article class="evidence-card"><small>EVIDENCE ${String(index + 1).padStart(2, "0")}</small><b>${escapeHtml(clue.title)}</b><p>${escapeHtml(clue.summary || "这条线索暂时没有进一步说明。")}</p></article>`).join("")
    : `<div class="empty-evidence"><i></i><p>先观察房间。只有真正发现的线索才会出现在这里。</p></div>`;
}

function renderRoom() {
  if (!state || !activeSeatId) return renderLanding();
  const view = viewForSeat(state, activeSeatId);
  applyTheme(view);
  $("#landingView").hidden = true;
  $("#roomView").hidden = false;
  $("#caseId").textContent = state.id.slice(-10).toUpperCase();
  $("#gameTypeLabel").textContent = view.gameType === "trpg" ? "ACTIVE CAMPAIGN" : "ACTIVE CASE";
  $("#caseTitle").textContent = `${view.theme.world} · ${view.theme.tone} · ${GAME_TYPES[view.gameType].label}`;
  $("#roomWorld").textContent = view.theme.world;
  $("#roomTone").textContent = view.theme.tone;
  $("#seatCount").textContent = `${view.seats.length} / ${MODES[view.mode].maxSeats}`;
  $("#roomInvite").textContent = state.inviteCode || "LOCAL-DEMO";
  $("#roundNumber").textContent = view.round;
  $("#stateVersion").textContent = view.version;
  $("#eventCursor").textContent = view.eventCursor;
  $("#mapProgress").textContent = `${Math.min(18 + view.clues.length * 14, 94)}%`;
  $("#refereeDisplayName").textContent = view.referee.displayName;
  $("#refereeRouteLabel").textContent = `${view.referee.routeLabel} · ${view.referee.platform}`;

  const self = view.seats.find((seat) => seat.id === view.selfSeatId);
  const current = view.seats.find((seat) => seat.id === view.currentSeatId);
  $("#turnOwner").textContent = view.status === "lobby" ? "等待所有席位准备" : `${current?.displayName || view.referee.displayName} 正在行动`;
  $("#seatList").innerHTML = view.seats.map((seat) => `
    <div class="seat${seat.role === "spectator" ? " seat--spectator" : ""}">
      <span class="seat__mark">${escapeHtml(seat.displayName.slice(0, 1))}</span>
      <span><b>${escapeHtml(seat.displayName)}</b><small>${seat.kind === "ai" ? "AI" : "人类"} · ${seat.role === "spectator" ? "观战席" : "玩家席"} · ${escapeHtml(seat.platform)}</small></span>
    </div>`).join("") + Array.from({ length: Math.max(0, MODES[view.mode].minSeats - view.seats.length) }, () => `<div class="seat seat--empty"><span class="seat__mark">＋</span><span><b>等待同伴</b><small>用邀请码从其他平台入席</small></span></div>`).join("");

  const isTrpg = view.gameType === "trpg";
  $("#roomPlan").hidden = isTrpg;
  $("#trpgDesk").hidden = !isTrpg;
  $("#sceneTitle").textContent = isTrpg ? "第一幕等待一句行动" : "灯刚刚亮起";
  $("#sceneDescription").textContent = isTrpg
    ? `由${view.referee.displayName}主持的${view.theme.world}故事刚刚开场。空气带着${view.theme.tone}的预兆；裁判知道世界事实，玩家只知道角色眼前的部分。`
    : "入口室的灯管发出轻微电流声。墙上的钟停在 02:17，玻璃后的线路图缺了一站，而门禁屏幕只显示一行：请由下一位观察者确认。";
  $("#actionInput").placeholder = isTrpg ? "例如：我向守门人出示那封未署名的信" : "例如：查看停摆的钟";
  $("#observeAction").textContent = isTrpg ? "提交行动" : "观察现场";
  $("#observeAction").disabled = view.actionRequired !== "act";
  $("#rollD20").disabled = !isTrpg || view.actionRequired !== "act";

  if (isTrpg) {
    const player = view.seats.find((seat) => seat.role === "player");
    $("#characterName").textContent = player?.displayName || "尚未登记";
    $("#characterRole").textContent = CHARACTER_ROLES[view.theme.world] || "等待裁判分配身份";
    const lastRoll = [...view.events].reverse().find((event) => event.type === "trpg.rolled");
    $("#diceResult").textContent = lastRoll ? `${lastRoll.data.roll}${lastRoll.data.success ? " ✓" : " ×"}` : "—";
  }

  renderChat(view);
  const timeline = view.events.filter((event) => !["chat.sent", "player.said"].includes(event.type));
  $("#eventStream").innerHTML = timeline.slice(-10).reverse().map((event) => `<div class="event-entry" data-seq="${event.seq}">${friendlyEvent(event)}</div>`).join("");
  renderEvidence(view);
  if (self?.role === "spectator") $("#globalStatus").textContent = "观战席：可聊天，不接收行动轮次或私有线索";
}

function prepareLocalCompanion(personaName) {
  const mode = state.mode;
  let role = "player";
  let displayName = personaName || "本机演示人格";
  if (mode === "human_play_ai_watch") role = "spectator";
  if (mode === "ai_party") displayName = `${displayName} · 同行`;
  if (["duo", "ai_party", "mixed_party", "human_play_ai_watch", "ai_play_human_watch"].includes(mode)) {
    const id = makeId("seat");
    joinSeat(state, { id, kind: "ai", role, displayName, platform: "demo（预设 · 非真实 AI）" });
    state.localDemoSeatId = id;
  }
}

function beginDemoIfPossible() {
  state.seats.forEach((seat) => setSeatReady(state, seat.id, true));
  if (state.seats.length >= MODES[state.mode].minSeats) startGame(state, activeSeatId);
}

function takeDemoTurn(initial = false) {
  const demo = state.seats.find((seat) => seat.id === state.localDemoSeatId);
  if (!demo || demo.role === "spectator" || state.currentSeatId !== demo.id) return;
  if (state.gameType === "trpg") {
    const roll = initial ? 14 : 11;
    recordPlayerEvent(state, { seatId: demo.id, type: "trpg.rolled", requestId: crypto.randomUUID(), data: { roll, difficulty: 12, success: roll >= 12, demo: true } });
  } else {
    recordPlayerEvent(state, { seatId: demo.id, type: "player.acted", requestId: crypto.randomUUID(), data: { action: "demo-observe", target: initial ? "本机演示人格检查了入口处的光源" : "本机演示人格记录了门禁屏幕的变化", demo: true } });
  }
}

function sendDemoChatReply() {
  const demo = state.seats.find((seat) => seat.id === state.localDemoSeatId);
  if (!demo) return;
  const roleText = demo.role === "spectator" ? "我会留在观战席，只通过公共频道给提示。" : "我收到了；真正接入后，这里会由游玩人格自己回复。";
  recordPlayerEvent(state, { seatId: demo.id, type: "chat.sent", requestId: crypto.randomUUID(), data: { content: roleText, demo: true } });
}

$("#createForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const mode = currentMode();
  const gameType = currentGameType();
  const displayName = $("#displayName").value.trim() || "玩家";
  const personaName = $("#playerPersonaName").value.trim() || "本机演示人格";
  const refereeName = $("#refereeName").value.trim() || "规则裁判";
  const routeLabel = $("#refereeRoute").value;
  const creatorIsAi = mode === "ai_solo" || mode === "ai_party";
  const creator = {
    id: makeId("seat"),
    kind: creatorIsAi ? "ai" : "human",
    role: mode === "ai_play_human_watch" ? "spectator" : "player",
    displayName: creatorIsAi ? personaName : displayName,
    platform: "web"
  };
  activeSeatId = creator.id;
  state = createGame({
    id: makeId("game"),
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    gameType,
    mode,
    creator,
    referee: { displayName: refereeName, routeLabel, platform: routeLabel === "本机规则演示" ? "local-demo" : "配置记录（未连接）" }
  });
  state.inviteCode = randomCode();
  prepareLocalCompanion(personaName);
  beginDemoIfPossible();
  if (mode === "ai_play_human_watch") takeDemoTurn(true);
  saveState("本机演示已建立并即时存档");
  $("#worldPreview").textContent = state.theme.world;
  $("#tonePreview").textContent = state.theme.tone;
  renderRoom();
  toast(`抽中：${state.theme.world} × ${state.theme.tone}`);
});

$("#observeAction").addEventListener("click", () => {
  const target = $("#actionInput").value.trim();
  if (!target) return toast(state.gameType === "trpg" ? "先写下角色准备采取的行动" : "先写下你想观察的地方或物品");
  try {
    if (state.gameType === "trpg") {
      recordPlayerEvent(state, { seatId: activeSeatId, type: "player.acted", requestId: crypto.randomUUID(), data: { action: "roleplay", target } });
    } else {
      recordPlayerEvent(state, { seatId: activeSeatId, type: "player.observed", requestId: crypto.randomUUID(), data: { target } });
      const clueNumber = state.publicClues.length + 1;
      discoverClue(state, {
        clueId: `local-${clueNumber}`,
        title: clueNumber === 1 ? "停在 02:17 的钟" : `关于“${target.slice(0, 12)}”的痕迹`,
        summary: clueNumber === 1 ? "秒针没有损坏。有人主动切断了它与站内时间服务器的同步。" : "这条本机演示线索已由独立裁判写入即时存档。",
        actorSeatId: activeSeatId
      });
    }
    $("#actionInput").value = "";
    takeDemoTurn();
    saveState();
    renderRoom();
    toast(state.gameType === "trpg" ? "行动已交给独立裁判记录" : "观察结果已写入存档");
  } catch (error) {
    const messages = { not_your_turn: "现在轮到另一位玩家", spectator_cannot_act: "观战席不能执行动作，但仍可在无线电聊天" };
    toast(messages[error.message] || "这一步暂时不能执行");
  }
});

$("#rollD20").addEventListener("click", () => {
  try {
    const roll = crypto.getRandomValues(new Uint32Array(1))[0] % 20 + 1;
    recordPlayerEvent(state, { seatId: activeSeatId, type: "trpg.rolled", requestId: crypto.randomUUID(), data: { roll, difficulty: 12, success: roll >= 12 } });
    takeDemoTurn();
    saveState();
    renderRoom();
    toast(`d20 掷出 ${roll}：${roll >= 12 ? "检定通过" : "未通过"}`);
  } catch (error) {
    toast(error.message === "spectator_cannot_act" ? "观战席不能代替玩家掷骰" : "当前还不能进行检定");
  }
});

$("#chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const content = $("#chatInput").value.trim();
  if (!content) return toast("先写下要发送的话");
  recordPlayerEvent(state, { seatId: activeSeatId, type: "chat.sent", requestId: crypto.randomUUID(), data: { content } });
  $("#chatInput").value = "";
  sendDemoChatReply();
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
if (state) $("#globalStatus").textContent = "找到一份本机即时存档";
renderLanding();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
