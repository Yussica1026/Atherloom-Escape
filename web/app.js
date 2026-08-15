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
import { createLocalOpening } from "../shared/referee-prompt.mjs";
import { EscapeRelayClient, RelayError, RELAY_URL } from "./relay-client.js";
import { generateMapModel, mapSvgMarkup } from "./map-generator.js";

const STORAGE_KEY = "atherloom:escape:local-game:v1";
const ONLINE_KEY = "atherloom:escape:online-session:v1";
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
let onlineSession = loadOnlineSession();
const relayOverride = ["127.0.0.1", "localhost"].includes(location.hostname)
  ? new URLSearchParams(location.search).get("relay") || onlineSession?.relayUrl
  : "";
const relay = new EscapeRelayClient({ baseUrl: relayOverride || RELAY_URL });
let runtimeMode = "local";
let activeSeatId = state?.activeSeatId || state?.seats?.[0]?.id || null;
let toastTimer = null;
let pollTimer = null;
let relayQueue = Promise.resolve();
let relayPending = 0;

function normalizeState(candidate) {
  if (!candidate) return null;
  candidate.gameType ||= "escape";
  candidate.referee ||= { displayName: "规则裁判", routeId: "local-demo", routeLabel: "本机规则演示", platform: "local-demo" };
  candidate.referee.routeId ||= "local-demo";
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

function loadOnlineSession() {
  try {
    const session = JSON.parse(localStorage.getItem(ONLINE_KEY) || "null");
    return session?.gameId && session?.seatToken ? session : null;
  } catch { return null; }
}

function isOnline() { return runtimeMode === "online"; }

function setConnectionStatus(message, status = "local") {
  $("#globalStatus").textContent = message;
  $("#syncDot").dataset.state = status;
}

function hydrateOnlineState(view) {
  state = normalizeState({
    ...view,
    inviteCode: onlineSession?.inviteCode || "",
    connectionKind: "online"
  });
  activeSeatId = view.selfSeatId || onlineSession?.seatId || activeSeatId;
  return state;
}

function saveOnlineSession(session) {
  onlineSession = { relayUrl: relay.baseUrl, ...session };
  localStorage.setItem(ONLINE_KEY, JSON.stringify(onlineSession));
}

function saveState(message = "本机即时存档完成") {
  state.activeSeatId = activeSeatId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setConnectionStatus(message, "local");
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

function selectedRefereeRoute() {
  const select = $("#refereeRoute");
  return {
    routeId: select.value,
    routeLabel: select.selectedOptions[0]?.textContent.trim() || "独立裁判路线"
  };
}

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
  stopPolling();
  $("#landingView").hidden = false;
  $("#roomView").hidden = true;
  $("#archiveNumber").textContent = archiveNumber();
  $("#worldPreview").textContent = "世界待抽取";
  $("#tonePreview").textContent = "气质待抽取";
  updateConnectionChoice();
}

function updateConnectionChoice() {
  const choice = formValue("connection", "online");
  const online = choice === "online";
  const route = $("#refereeRoute");
  if (online && route.value === "local-demo") route.value = "workers-ai";
  if (!online && route.value === "workers-ai") route.value = "local-demo";
  $("#createRoom").textContent = online ? "抽取并建立联机房间" : "抽取并建立本机演示";
  $("#resumeGame").hidden = online ? !onlineSession : !loadState();
  $("#resumeGame").textContent = online ? "回到上次联机现场" : "继续本机演示现场";
  if ($("#landingView").hidden) return;
  setConnectionStatus(online ? (onlineSession ? "找到一份联机席位凭证" : "联机 Relay 待连接") : (loadState() ? "找到一份本机即时存档" : "本机演示已就绪"), online ? "connecting" : "local");
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
      { title: "当前任务", summary: view.opening?.objective || "等待裁判公开本幕目标。" }
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

function openingForView(view) {
  if (view.opening) return view.opening;
  const provisionalMap = generateMapModel({
    seed: view.seed,
    world: view.theme.world,
    tone: view.theme.tone,
    gameType: view.gameType
  });
  return createLocalOpening({
    refereeName: view.referee.displayName,
    gameType: view.gameType,
    world: view.theme.world,
    tone: view.theme.tone,
    mapPlaces: provisionalMap.nodes.map((node) => node.label)
  });
}

function renderGeneratedMap(view, opening) {
  const model = generateMapModel({
    seed: view.seed,
    world: view.theme.world,
    tone: view.theme.tone,
    gameType: view.gameType,
    mapPlaces: opening.mapPlaces
  });
  const svg = $("#generatedMap");
  const title = view.gameType === "trpg" ? "本局旅途路线" : "本局密室结构";
  svg.innerHTML = `<title id="planTitle">${title}</title>${mapSvgMarkup({ ...model, dangerLabel: opening.dangerLabel || model.dangerLabel })}`;
  svg.dataset.kind = model.kind;
  $("#mapProgress").textContent = model.metric;
  $("#mapCaptionLabel").textContent = model.caption;
  return model;
}

function renderRoom() {
  if (!state || !activeSeatId) return renderLanding();
  const view = isOnline() ? state : viewForSeat(state, activeSeatId);
  const opening = openingForView(view);
  applyTheme(view);
  $("#landingView").hidden = true;
  $("#roomView").hidden = false;
  $("#caseId").textContent = state.id.slice(-10).toUpperCase();
  $("#gameTypeLabel").textContent = view.gameType === "trpg" ? "ACTIVE CAMPAIGN" : "ACTIVE CASE";
  $("#caseTitle").textContent = opening.title;
  $("#roomWorld").textContent = view.theme.world;
  $("#roomTone").textContent = view.theme.tone;
  $("#seatCount").textContent = `${view.seats.length} / ${MODES[view.mode].maxSeats}`;
  $("#roomInvite").textContent = state.inviteCode || "LOCAL-DEMO";
  $("#roundNumber").textContent = view.round;
  $("#stateVersion").textContent = view.version;
  $("#eventCursor").textContent = view.eventCursor;
  $("#saveLocation").textContent = isOnline() ? "Relay 联机存档" : "本机演示";
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
  renderGeneratedMap(view, opening);
  $("#roomPlan").hidden = false;
  $("#trpgDesk").hidden = !isTrpg;
  $("#sceneTitle").textContent = opening.title;
  $("#sceneDescription").textContent = opening.opening;
  $("#startLocation").textContent = opening.startLocation;
  $("#questTitle").textContent = opening.objective;
  $("#actionInput").placeholder = isTrpg ? `描述你在“${opening.startLocation}”采取的行动` : `描述你要调查“${opening.startLocation}”的什么`;
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
  if (isOnline()) {
    const message = self?.role === "spectator" ? "Relay 已同步 · 观战席可聊天" : view.status === "lobby" ? "Relay 已同步 · 等待其他席位入场" : view.actionRequired === "act" ? "Relay 已同步 · 轮到你行动" : "Relay 已同步 · 等待其他玩家行动";
    setConnectionStatus(message, "online");
    startPolling();
  } else if (self?.role === "spectator") {
    setConnectionStatus("观战席：可聊天，不接收行动轮次或私有线索", "local");
  }
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
    const place = state.opening?.mapPlaces?.[initial ? 0 : 1] || state.opening?.startLocation || "当前区域";
    recordPlayerEvent(state, { seatId: demo.id, type: "player.acted", requestId: crypto.randomUUID(), data: { action: "demo-observe", target: `本机演示人格调查了“${place}”`, demo: true } });
  }
}

function sendDemoChatReply() {
  const demo = state.seats.find((seat) => seat.id === state.localDemoSeatId);
  if (!demo) return;
  const roleText = demo.role === "spectator" ? "我会留在观战席，只通过公共频道给提示。" : "我收到了；真正接入后，这里会由游玩人格自己回复。";
  recordPlayerEvent(state, { seatId: demo.id, type: "chat.sent", requestId: crypto.randomUUID(), data: { content: roleText, demo: true } });
}

const RELAY_MESSAGES = {
  invite_not_found: "邀请码不存在或已经失效",
  room_full: "房间已经坐满了",
  player_slots_full: "玩家席已经满了，可以改选观战席",
  game_already_started: "这局已经开场，不能再加入",
  unauthorized: "这份联机席位凭证已经失效",
  version_conflict: "现场刚被另一位参与者更新，正在重新同步",
  not_enough_players: "还要等其他席位入场",
  players_not_ready: "还有席位没有准备好",
  not_your_turn: "现在轮到另一位玩家",
  spectator_cannot_act: "观战席不能行动，但可以继续聊天",
  game_not_active: "房间还没有正式开场",
  referee_ai_unavailable: "独立裁判 AI 当前没有连接",
  invalid_referee_opening: "独立裁判没有返回完整开场",
  referee_theme_mismatch: "独立裁判写出的开场与本局题材不匹配",
  referee_generation_failed: "独立裁判生成开场失败，请重新建局",
  referee_route_unavailable: "所选裁判路线尚未接通"
};

function relayMessage(error) {
  return RELAY_MESSAGES[error?.code] || error?.message || "联机服务暂时无法完成这一步";
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  if (!isOnline() || pollTimer) return;
  pollTimer = setInterval(() => {
    if (!document.hidden && isOnline() && relayPending === 0) refreshOnline(true).catch(() => {});
  }, 2200);
}

function queueRelay(task) {
  relayPending += 1;
  const run = relayQueue.catch(() => {}).then(task);
  const settled = run.finally(() => { relayPending -= 1; });
  relayQueue = settled.catch(() => {});
  return settled;
}

function refreshOnline(silent = false) {
  if (!onlineSession || (silent && relayPending > 0)) return Promise.resolve(state);
  return queueRelay(async () => {
    try {
      const view = await relay.getState(onlineSession.gameId, onlineSession.seatToken);
      const changed = !state || view.version !== state.version;
      hydrateOnlineState(view);
      if (changed || !silent) renderRoom();
      else setConnectionStatus("Relay 已同步 · 没有遗漏新记录", "online");
      return state;
    } catch (error) {
      setConnectionStatus(relayMessage(error), "error");
      if (!silent) toast(relayMessage(error));
      throw error;
    }
  });
}

function mutateOnline(operation, maxConflicts = 4) {
  if (!onlineSession) return Promise.reject(new RelayError("unauthorized", RELAY_MESSAGES.unauthorized, 401));
  return queueRelay(async () => {
    setConnectionStatus("正在把这一步写入 Relay…", "connecting");
    for (let attempt = 0; attempt <= maxConflicts; attempt += 1) {
      try {
        const view = await operation(state.version);
        hydrateOnlineState(view);
        renderRoom();
        return state;
      } catch (error) {
        if (error?.code !== "version_conflict" || attempt === maxConflicts) {
          setConnectionStatus(relayMessage(error), "error");
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
        hydrateOnlineState(await relay.getState(onlineSession.gameId, onlineSession.seatToken));
      }
    }
    return state;
  });
}

async function readyAndStartOnline() {
  await mutateOnline((version) => relay.setReady(onlineSession.gameId, onlineSession.seatToken, version, true));
  const mode = MODES[state.mode];
  const players = state.seats.filter((seat) => seat.role !== "spectator");
  const canStart = state.seats.length >= mode.minSeats
    && players.length >= (mode.minPlayers || mode.minSeats)
    && state.seats.every((seat) => seat.ready);
  if (!canStart) {
    setConnectionStatus("Relay 已同步 · 等待其他席位入场", "online");
    return;
  }
  await mutateOnline((version) => relay.startGame(onlineSession.gameId, onlineSession.seatToken, version));
}

async function createOnlineGame({ mode, gameType, displayName, refereeName, routeId, routeLabel }) {
  runtimeMode = "online";
  stopPolling();
  setConnectionStatus("正在请独立裁判抽取地图与开场…", "connecting");
  const role = mode === "ai_play_human_watch" ? "spectator" : "player";
  const response = await relay.createGame({
    game_type: gameType,
    mode,
    kind: "human",
    role,
    display_name: displayName,
    platform: "web",
    referee: {
      display_name: refereeName,
      route_id: routeId,
      route_label: routeLabel,
      platform: routeId === "workers-ai" ? "workers-ai" : routeId === "local-demo" ? "relay-rules" : "route-reserved"
    }
  });
  saveOnlineSession({
    gameId: response.game_id,
    seatId: response.seat_id,
    seatToken: response.seat_token,
    inviteCode: response.invite_code
  });
  activeSeatId = response.seat_id;
  await refreshOnline(true);
  await readyAndStartOnline();
  renderRoom();
  toast(`联机房间已建立：${response.theme.world} × ${response.theme.tone}`);
}

async function joinOnlineGame(code, displayName, role) {
  runtimeMode = "online";
  stopPolling();
  setConnectionStatus("正在验证邀请码并领取席位…", "connecting");
  const response = await relay.joinGame({
    invite_code: code,
    kind: "human",
    role,
    display_name: displayName,
    platform: "web"
  });
  saveOnlineSession({
    gameId: response.game_id,
    seatId: response.seat_id,
    seatToken: response.seat_token,
    inviteCode: code.replaceAll("-", "").replace(/(.{4})/, "$1-")
  });
  activeSeatId = response.seat_id;
  await refreshOnline(true);
  await readyAndStartOnline();
  renderRoom();
  toast(role === "spectator" ? "已进入观战席" : "已进入玩家席");
}

$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#createRoom");
  const mode = currentMode();
  const gameType = currentGameType();
  const displayName = $("#displayName").value.trim() || "玩家";
  const personaName = $("#playerPersonaName").value.trim() || "本机演示人格";
  const refereeName = $("#refereeName").value.trim() || "规则裁判";
  const selectedRoute = selectedRefereeRoute();
  button.disabled = true;
  try {
    if (formValue("connection", "online") === "online") {
      await createOnlineGame({ mode, gameType, displayName, refereeName, ...selectedRoute });
      return;
    }
    runtimeMode = "local";
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
    referee: { displayName: refereeName, routeId: "local-demo", routeLabel: "本机规则演示", platform: "local-demo" }
  });
  const localMap = generateMapModel({ seed: state.seed, world: state.theme.world, tone: state.theme.tone, gameType: state.gameType });
  state.opening = createLocalOpening({
    refereeName,
    gameType: state.gameType,
    world: state.theme.world,
    tone: state.theme.tone,
    mapPlaces: localMap.nodes.map((node) => node.label)
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
  } catch (error) {
    toast(relayMessage(error));
    setConnectionStatus(relayMessage(error), "error");
  } finally {
    button.disabled = false;
  }
});

$("#observeAction").addEventListener("click", async () => {
  const target = $("#actionInput").value.trim();
  if (!target) return toast(state.gameType === "trpg" ? "先写下角色准备采取的行动" : "先写下你想观察的地方或物品");
  try {
    if (isOnline()) {
      const type = state.gameType === "trpg" ? "player.acted" : "player.observed";
      const data = state.gameType === "trpg" ? { action: "roleplay", target } : { target };
      const requestId = crypto.randomUUID();
      await mutateOnline((version) => relay.sendEvent(onlineSession.gameId, onlineSession.seatToken, version, type, data, requestId));
      $("#actionInput").value = "";
      toast(state.gameType === "trpg" ? "行动已写入 Relay，等待独立裁判路线" : "观察已写入 Relay，并轮到下一位玩家");
      return;
    }
    if (state.gameType === "trpg") {
      recordPlayerEvent(state, { seatId: activeSeatId, type: "player.acted", requestId: crypto.randomUUID(), data: { action: "roleplay", target } });
    } else {
      recordPlayerEvent(state, { seatId: activeSeatId, type: "player.observed", requestId: crypto.randomUUID(), data: { target } });
      const clueNumber = state.publicClues.length + 1;
      discoverClue(state, {
        clueId: `local-${clueNumber}`,
        title: `关于“${target.slice(0, 12)}”的痕迹`,
        summary: `这条本机规则演示线索属于${state.theme.world} × ${state.theme.tone}现场，已写入即时存档。`,
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
    toast(isOnline() ? relayMessage(error) : (messages[error.message] || "这一步暂时不能执行"));
  }
});

$("#rollD20").addEventListener("click", async () => {
  try {
    if (isOnline()) {
      const requestId = crypto.randomUUID();
      await mutateOnline((version) => relay.sendEvent(onlineSession.gameId, onlineSession.seatToken, version, "trpg.rolled", { difficulty: 12, label: "行动检定" }, requestId));
      const lastRoll = [...state.events].reverse().find((event) => event.type === "trpg.rolled");
      toast(`Relay d20：${lastRoll?.data.roll || "—"}${lastRoll?.data.success ? " · 通过" : " · 未通过"}`);
      return;
    }
    const roll = crypto.getRandomValues(new Uint32Array(1))[0] % 20 + 1;
    recordPlayerEvent(state, { seatId: activeSeatId, type: "trpg.rolled", requestId: crypto.randomUUID(), data: { roll, difficulty: 12, success: roll >= 12 } });
    takeDemoTurn();
    saveState();
    renderRoom();
    toast(`d20 掷出 ${roll}：${roll >= 12 ? "检定通过" : "未通过"}`);
  } catch (error) {
    toast(isOnline() ? relayMessage(error) : (error.message === "spectator_cannot_act" ? "观战席不能代替玩家掷骰" : "当前还不能进行检定"));
  }
});

$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = $("#chatInput").value.trim();
  if (!content) return toast("先写下要发送的话");
  try {
    if (isOnline()) {
      const requestId = crypto.randomUUID();
      await mutateOnline((version) => relay.sendEvent(onlineSession.gameId, onlineSession.seatToken, version, "chat.sent", { content }, requestId));
      $("#chatInput").value = "";
      return;
    }
    recordPlayerEvent(state, { seatId: activeSeatId, type: "chat.sent", requestId: crypto.randomUUID(), data: { content } });
    $("#chatInput").value = "";
    sendDemoChatReply();
    saveState();
    renderRoom();
  } catch (error) {
    toast(isOnline() ? relayMessage(error) : "这句话暂时无法发送");
  }
});

$("#showJoin").addEventListener("click", () => { $("#joinForm").hidden = false; $("#inviteCode").focus(); });
$("#hideJoin").addEventListener("click", () => { $("#joinForm").hidden = true; });
$("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = $("#inviteCode").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}-?[A-Z2-9]{4}$/.test(code)) return toast("邀请码格式不正确");
  const button = $("#joinRoom");
  button.disabled = true;
  try {
    await joinOnlineGame(code, $("#joinDisplayName").value.trim() || "访客", $("#joinRole").value);
    $("#joinForm").hidden = true;
  } catch (error) {
    toast(relayMessage(error));
    setConnectionStatus(relayMessage(error), "error");
  } finally {
    button.disabled = false;
  }
});

$("#copyInvite").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(state.inviteCode); toast("邀请码已复制"); }
  catch { toast(`邀请码：${state.inviteCode}`); }
});

$("#backHome").addEventListener("click", renderLanding);
$("#resumeGame").addEventListener("click", async () => {
  if (formValue("connection", "online") === "online") {
    if (!onlineSession) return toast("没有找到可恢复的联机席位");
    runtimeMode = "online";
    setConnectionStatus("正在恢复上次联机现场…", "connecting");
    try { await refreshOnline(false); } catch { /* 状态与提示已由 refreshOnline 更新 */ }
    return;
  }
  runtimeMode = "local";
  state = loadState();
  activeSeatId = state?.activeSeatId || state?.seats?.[0]?.id || null;
  renderRoom();
});
$(".brand").addEventListener("click", (event) => { event.preventDefault(); renderLanding(); });
$$('input[name="connection"]').forEach((input) => input.addEventListener("change", updateConnectionChoice));
$("#displayName").addEventListener("input", () => { if (!$("#joinDisplayName").value.trim()) $("#joinDisplayName").value = $("#displayName").value; });
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
renderLanding();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && isOnline() && !$("#roomView").hidden) refreshOnline(true).catch(() => {});
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
