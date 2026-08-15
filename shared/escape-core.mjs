export const WORLDS = Object.freeze(["古代", "现代", "科幻", "近现代", "中世纪", "西幻"]);
export const TONES = Object.freeze(["甜宠", "日常", "正剧", "BE", "恐怖"]);
export const MODES = Object.freeze({
  ai_solo: { label: "AI 独行", minSeats: 1, maxSeats: 1, seats: ["ai"] },
  duo: { label: "双人协作", minSeats: 2, maxSeats: 2, seats: ["human", "ai"] },
  ai_party: { label: "AI 小队", minSeats: 2, maxSeats: 4, seats: ["ai", "ai"] },
  mixed_party: { label: "混合小队", minSeats: 2, maxSeats: 4, seats: ["human", "ai"] }
});

export const EVENT_TYPES = Object.freeze([
  "game.created",
  "seat.joined",
  "seat.ready",
  "game.started",
  "turn.assigned",
  "player.said",
  "player.observed",
  "player.acted",
  "clue.discovered",
  "inventory.changed",
  "game.paused",
  "game.resumed",
  "game.ended"
]);

export function normalizeSeed(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function seededRandom(seed) {
  let state = normalizeSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawTheme(seed) {
  const random = seededRandom(seed);
  return {
    world: WORLDS[Math.floor(random() * WORLDS.length)],
    tone: TONES[Math.floor(random() * TONES.length)]
  };
}

export function createGame({ id, seed, mode = "duo", creator, now = Date.now() }) {
  if (!MODES[mode]) throw new Error("unknown_mode");
  if (!creator?.id || !creator?.displayName || !["human", "ai"].includes(creator.kind)) {
    throw new Error("invalid_creator");
  }
  const normalizedSeed = normalizeSeed(seed ?? `${id}:${now}`);
  const theme = drawTheme(normalizedSeed);
  return {
    id,
    seed: normalizedSeed,
    theme,
    mode,
    status: "lobby",
    phase: "assembly",
    version: 1,
    eventCursor: 1,
    currentSeatId: null,
    round: 0,
    createdAt: now,
    updatedAt: now,
    seats: [{
      id: creator.id,
      kind: creator.kind,
      displayName: creator.displayName,
      platform: creator.platform || "web",
      ready: false,
      seatNo: 1
    }],
    sharedInventory: [],
    publicClues: [],
    privateClues: {},
    events: [{
      seq: 1,
      type: "game.created",
      actorSeatId: creator.id,
      visibility: "public",
      data: { theme, mode },
      createdAt: now
    }]
  };
}

function appendEvent(state, event, now) {
  const seq = state.eventCursor + 1;
  state.eventCursor = seq;
  state.version += 1;
  state.updatedAt = now;
  state.events.push({ seq, createdAt: now, visibility: "public", ...event });
}

export function joinSeat(state, seat, now = Date.now()) {
  if (state.status !== "lobby") throw new Error("game_already_started");
  const mode = MODES[state.mode];
  if (state.seats.length >= mode.maxSeats) throw new Error("room_full");
  if (!seat?.id || !seat?.displayName || !["human", "ai"].includes(seat.kind)) throw new Error("invalid_seat");
  if (state.seats.some((item) => item.id === seat.id)) return state;
  state.seats.push({
    id: seat.id,
    kind: seat.kind,
    displayName: seat.displayName,
    platform: seat.platform || "web",
    ready: false,
    seatNo: state.seats.length + 1
  });
  appendEvent(state, {
    type: "seat.joined",
    actorSeatId: seat.id,
    data: { seatId: seat.id, kind: seat.kind, displayName: seat.displayName, platform: seat.platform || "web" }
  }, now);
  return state;
}

export function setSeatReady(state, seatId, ready = true, now = Date.now()) {
  if (state.status !== "lobby") throw new Error("game_already_started");
  const seat = state.seats.find((item) => item.id === seatId);
  if (!seat) throw new Error("seat_not_found");
  if (seat.ready === Boolean(ready)) return state;
  seat.ready = Boolean(ready);
  appendEvent(state, {
    type: "seat.ready",
    actorSeatId: seatId,
    data: { seatId, ready: seat.ready }
  }, now);
  return state;
}

export function startGame(state, seatId, now = Date.now()) {
  if (state.status !== "lobby") throw new Error("game_already_started");
  const mode = MODES[state.mode];
  if (state.seats.length < mode.minSeats) throw new Error("not_enough_players");
  if (state.seats.some((seat) => !seat.ready)) throw new Error("players_not_ready");
  state.status = "active";
  state.phase = "exploration";
  state.round = 1;
  state.currentSeatId = state.seats[0].id;
  appendEvent(state, {
    type: "game.started",
    actorSeatId: seatId,
    data: { firstSeatId: state.currentSeatId, round: state.round }
  }, now);
  appendEvent(state, {
    type: "turn.assigned",
    actorSeatId: null,
    data: { seatId: state.currentSeatId, round: state.round }
  }, now);
  return state;
}

export function nextTurn(state, now = Date.now()) {
  if (state.status !== "active") throw new Error("game_not_active");
  const currentIndex = Math.max(0, state.seats.findIndex((seat) => seat.id === state.currentSeatId));
  const nextIndex = (currentIndex + 1) % state.seats.length;
  if (nextIndex === 0) state.round += 1;
  state.currentSeatId = state.seats[nextIndex].id;
  appendEvent(state, {
    type: "turn.assigned",
    actorSeatId: null,
    data: { seatId: state.currentSeatId, round: state.round }
  }, now);
  return state;
}

export function recordPlayerEvent(state, { seatId, type, data, requestId, visibility = "public", visibleSeatId = null }, now = Date.now()) {
  if (state.status !== "active") throw new Error("game_not_active");
  if (!state.seats.some((seat) => seat.id === seatId)) throw new Error("seat_not_found");
  if (!["player.said", "player.observed", "player.acted"].includes(type)) throw new Error("event_not_allowed");
  if (requestId && state.events.some((event) => event.requestId === requestId && event.actorSeatId === seatId)) return state;
  if (type !== "player.said" && state.currentSeatId !== seatId) throw new Error("not_your_turn");
  appendEvent(state, { type, actorSeatId: seatId, data, requestId, visibility, visibleSeatId }, now);
  if (type !== "player.said") nextTurn(state, now);
  return state;
}

export function discoverClue(state, { clueId, title, summary, actorSeatId = null, visibleSeatId = null }, now = Date.now()) {
  if (!clueId || !title) throw new Error("invalid_clue");
  if (visibleSeatId) {
    const list = state.privateClues[visibleSeatId] || [];
    if (!list.some((clue) => clue.id === clueId)) list.push({ id: clueId, title, summary: summary || "" });
    state.privateClues[visibleSeatId] = list;
  } else if (!state.publicClues.some((clue) => clue.id === clueId)) {
    state.publicClues.push({ id: clueId, title, summary: summary || "" });
  }
  appendEvent(state, {
    type: "clue.discovered",
    actorSeatId,
    visibility: visibleSeatId ? "seat" : "public",
    visibleSeatId,
    data: { clueId, title, summary: summary || "" }
  }, now);
  return state;
}

export function viewForSeat(state, seatId, after = 0) {
  const self = state.seats.find((seat) => seat.id === seatId);
  if (!self) throw new Error("seat_not_found");
  const events = state.events.filter((event) => event.seq > after && (
    event.visibility === "public" || event.visibleSeatId === seatId || event.actorSeatId === seatId
  ));
  return {
    id: state.id,
    seed: state.seed,
    theme: state.theme,
    mode: state.mode,
    status: state.status,
    phase: state.phase,
    version: state.version,
    eventCursor: state.eventCursor,
    selfSeatId: seatId,
    actionRequired: state.status === "lobby" ? (self.ready ? "wait_or_start" : "ready") : state.status === "active" ? (state.currentSeatId === seatId ? "act" : "wait") : "ended",
    currentSeatId: state.currentSeatId,
    round: state.round,
    seats: state.seats.map(({ id, kind, displayName, platform, ready, seatNo }) => ({ id, kind, displayName, platform, ready, seatNo })),
    sharedInventory: state.sharedInventory,
    clues: [...state.publicClues, ...(state.privateClues[seatId] || [])],
    events
  };
}

export function assertVersion(state, expectedVersion) {
  if (Number(expectedVersion) !== state.version) throw new Error("version_conflict");
}
