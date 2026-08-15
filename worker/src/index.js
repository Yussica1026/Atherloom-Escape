import {
  MODES,
  assertVersion,
  createGame,
  joinSeat,
  recordPlayerEvent,
  setSeatReady,
  startGame,
  viewForSeat
} from "../../shared/escape-core.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_BODY_BYTES = 32 * 1024;
let schemaReady = false;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function randomSecret(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const value = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${prefix}${value}`;
}

function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanText(value, maxLength = 120) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : false;
}

function corsHeaders(origin) {
  return origin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-request-id",
    "access-control-max-age": "600",
    vary: "Origin"
  } : {};
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("body_too_large");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("invalid_json"); }
}

function bearer(request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(`
CREATE TABLE IF NOT EXISTS escape_games(id TEXT PRIMARY KEY,invite_hash TEXT NOT NULL UNIQUE,game_type TEXT NOT NULL DEFAULT 'escape',mode TEXT NOT NULL,world TEXT NOT NULL,tone TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS escape_seats(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,client_id TEXT,seat_token_hash TEXT,kind TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'player',display_name TEXT NOT NULL,platform TEXT NOT NULL,seat_no INTEGER NOT NULL,joined_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,UNIQUE(game_id,client_id));
CREATE INDEX IF NOT EXISTS escape_seats_game ON escape_seats(game_id,seat_no);
CREATE INDEX IF NOT EXISTS escape_seats_token ON escape_seats(seat_token_hash);
CREATE TABLE IF NOT EXISTS escape_referees(game_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,route_label TEXT NOT NULL,platform TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS escape_audit(id TEXT PRIMARY KEY,game_id TEXT,seat_id TEXT,action TEXT NOT NULL,outcome TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS escape_audit_game ON escape_audit(game_id,created_at);
  `);
  const gameColumns = await db.prepare("PRAGMA table_info(escape_games)").all();
  if (!gameColumns.results?.some((column) => column.name === "game_type")) {
    await db.prepare("ALTER TABLE escape_games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'escape'").run();
  }
  const seatColumns = await db.prepare("PRAGMA table_info(escape_seats)").all();
  if (!seatColumns.results?.some((column) => column.name === "role")) {
    await db.prepare("ALTER TABLE escape_seats ADD COLUMN role TEXT NOT NULL DEFAULT 'player'").run();
  }
  schemaReady = true;
}

async function findClient(db, rawToken) {
  if (!rawToken) return null;
  try {
    return await db.prepare("SELECT id,display_name FROM clients WHERE token_hash=? AND disabled_at IS NULL").bind(await sha256(rawToken)).first();
  } catch {
    return null;
  }
}

async function gameRow(db, gameId) {
  return db.prepare("SELECT * FROM escape_games WHERE id=?").bind(gameId).first();
}

async function authSeat(request, db, gameId) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const direct = await db.prepare("SELECT * FROM escape_seats WHERE game_id=? AND seat_token_hash=?").bind(gameId, tokenHash).first();
  if (direct) return direct;
  const client = await findClient(db, token);
  if (!client) return null;
  return db.prepare("SELECT * FROM escape_seats WHERE game_id=? AND client_id=?").bind(gameId, client.id).first();
}

async function saveState(db, state, expectedVersion) {
  const result = await db.prepare("UPDATE escape_games SET status=?,version=?,state_json=?,updated_at=? WHERE id=? AND version=?")
    .bind(state.status, state.version, JSON.stringify(state), state.updatedAt, state.id, expectedVersion).run();
  if (!result.meta?.changes) throw new Error("version_conflict");
}

async function audit(db, gameId, seatId, action, outcome) {
  await db.prepare("INSERT INTO escape_audit(id,game_id,seat_id,action,outcome,created_at) VALUES(?,?,?,?,?,?)")
    .bind(uid("audit"), gameId || null, seatId || null, action, outcome, Date.now()).run();
}

function errorResponse(error, headers) {
  const code = error?.message || "internal_error";
  const statuses = {
    invalid_json: 400, body_too_large: 413, unauthorized: 401, forbidden_origin: 403,
    game_not_found: 404, invite_not_found: 404, seat_not_found: 404,
    room_full: 409, player_slots_full: 409, version_conflict: 409, game_already_started: 409,
    not_enough_players: 409, players_not_ready: 409, game_not_active: 409, not_your_turn: 409,
    spectator_cannot_act: 403, private_clue_requires_player: 422,
    invalid_creator: 422, invalid_seat: 422, unknown_game_type: 422, unknown_mode: 422, event_not_allowed: 422
  };
  const messages = {
    invalid_json: "请求不是有效的 JSON", body_too_large: "请求内容过大", unauthorized: "没有有效的席位身份",
    forbidden_origin: "当前网页来源不在允许列表", game_not_found: "密室不存在", invite_not_found: "邀请码无效或已失效",
    room_full: "席位已经坐满", player_slots_full: "玩家席已经坐满，只能加入观战席", version_conflict: "局面刚刚发生变化，请刷新后重试", game_already_started: "游戏已经开始",
    not_enough_players: "入席人数还不够", players_not_ready: "还有玩家没有准备", game_not_active: "游戏还没有正式开始", not_your_turn: "现在轮到另一位玩家",
    spectator_cannot_act: "观战席不能执行玩家动作", private_clue_requires_player: "私有线索只能交给玩家席",
    invalid_creator: "创建者信息不完整", invalid_seat: "席位信息不完整", unknown_game_type: "未知的玩法", unknown_mode: "未知的参与模式",
    event_not_allowed: "这种事件不能由玩家直接提交"
  };
  return json({ error: code, message: messages[code] || "密室服务暂时无法处理这一步" }, statuses[code] || 500, headers);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);
  if (origin === false) throw new Error("forbidden_origin");
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "atherloom-escape-relay", protocol: 1 }, 200, headers);
  await ensureSchema(env.DB);

  if (request.method === "POST" && url.pathname === "/v1/escape/games") {
    const body = await readBody(request);
    const mode = cleanText(body.mode || "duo", 20);
    const gameType = cleanText(body.game_type || "escape", 20);
    const kind = body.kind === "ai" ? "ai" : "human";
    const role = body.role === "spectator" ? "spectator" : "player";
    const displayName = cleanText(body.display_name, 24);
    const platform = cleanText(body.platform || "web", 30);
    const referee = {
      displayName: cleanText(body.referee?.display_name || "规则裁判", 24),
      routeLabel: cleanText(body.referee?.route_label || "独立裁判路线", 40),
      platform: cleanText(body.referee?.platform || "relay", 30)
    };
    const client = await findClient(env.DB, bearer(request));
    const gameId = uid("escape");
    const seatId = uid("seat");
    const code = inviteCode();
    const seatToken = client ? "" : randomSecret("aes_");
    const state = createGame({ id: gameId, gameType, mode, seed: crypto.getRandomValues(new Uint32Array(1))[0], creator: { id: seatId, kind, role, displayName, platform }, referee });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO escape_games(id,invite_hash,game_type,mode,world,tone,status,version,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(gameId, await sha256(code.replaceAll("-", "")), gameType, mode, state.theme.world, state.theme.tone, state.status, state.version, JSON.stringify(state), state.createdAt, state.updatedAt),
      env.DB.prepare("INSERT INTO escape_seats(id,game_id,client_id,seat_token_hash,kind,role,display_name,platform,seat_no,joined_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(seatId, gameId, client?.id || null, seatToken ? await sha256(seatToken) : null, kind, role, displayName, platform, 1, state.createdAt, state.createdAt),
      env.DB.prepare("INSERT INTO escape_referees(game_id,display_name,route_label,platform,created_at) VALUES(?,?,?,?,?)")
        .bind(gameId, referee.displayName, referee.routeLabel, referee.platform, state.createdAt)
    ]);
    await audit(env.DB, gameId, seatId, "game_create", "ok");
    return json({ game_id: gameId, seat_id: seatId, seat_token: seatToken || undefined, invite_code: code, theme: state.theme, game_type: gameType, mode, role, referee, version: state.version }, 201, headers);
  }

  if (request.method === "POST" && url.pathname === "/v1/escape/join") {
    const body = await readBody(request);
    const codeHash = await sha256(cleanText(body.invite_code, 16).toUpperCase().replaceAll("-", ""));
    const row = await env.DB.prepare("SELECT * FROM escape_games WHERE invite_hash=?").bind(codeHash).first();
    if (!row) throw new Error("invite_not_found");
    const state = JSON.parse(row.state_json);
    const client = await findClient(env.DB, bearer(request));
    if (client) {
      const existing = await env.DB.prepare("SELECT * FROM escape_seats WHERE game_id=? AND client_id=?").bind(row.id, client.id).first();
      if (existing) return json({ game_id: row.id, seat_id: existing.id, theme: state.theme, mode: state.mode, version: state.version }, 200, headers);
    }
    const seatId = uid("seat");
    const seatToken = client ? "" : randomSecret("aes_");
    const seat = { id: seatId, kind: body.kind === "human" ? "human" : "ai", role: body.role === "spectator" ? "spectator" : "player", displayName: cleanText(body.display_name || client?.display_name, 24), platform: cleanText(body.platform || "mcp", 30) };
    const expectedVersion = state.version;
    joinSeat(state, seat);
    await saveState(env.DB, state, expectedVersion);
    await env.DB.prepare("INSERT INTO escape_seats(id,game_id,client_id,seat_token_hash,kind,role,display_name,platform,seat_no,joined_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(seatId, row.id, client?.id || null, seatToken ? await sha256(seatToken) : null, seat.kind, seat.role, seat.displayName, seat.platform, state.seats.length, Date.now(), Date.now()).run();
    await audit(env.DB, row.id, seatId, "game_join", "ok");
    return json({ game_id: row.id, seat_id: seatId, seat_token: seatToken || undefined, theme: state.theme, game_type: state.gameType || "escape", mode: state.mode, role: seat.role, referee: state.referee, version: state.version }, 200, headers);
  }

  const match = url.pathname.match(/^\/v1\/escape\/games\/([^/]+)(?:\/(state|ready|start|events))?$/);
  if (!match) return json({ error: "not_found", message: "接口不存在" }, 404, headers);
  const gameId = match[1];
  const action = match[2] || "state";
  const row = await gameRow(env.DB, gameId);
  if (!row) throw new Error("game_not_found");
  const seat = await authSeat(request, env.DB, gameId);
  if (!seat) throw new Error("unauthorized");
  const state = JSON.parse(row.state_json);

  if (request.method === "GET" && action === "state") {
    const after = Math.max(0, Number(url.searchParams.get("after") || 0));
    await env.DB.prepare("UPDATE escape_seats SET last_seen_at=? WHERE id=?").bind(Date.now(), seat.id).run();
    return json(viewForSeat(state, seat.id, after), 200, headers);
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  const body = await readBody(request);
  if ((action === "ready" || action === "start") && state.status === "active") {
    return json(viewForSeat(state, seat.id, 0), 200, headers);
  }
  assertVersion(state, body.expected_version);
  const expectedVersion = state.version;
  if (action === "ready") setSeatReady(state, seat.id, body.ready !== false);
  else if (action === "start") startGame(state, seat.id);
  else if (action === "events") {
    const type = cleanText(body.type, 30);
    let data = body.data && typeof body.data === "object" ? body.data : {};
    if (state.status === "lobby") {
      const mode = MODES[state.mode];
      const players = state.seats.filter((item) => item.role !== "spectator");
      const canStart = state.seats.length >= mode.minSeats
        && players.length >= (mode.minPlayers || mode.minSeats)
        && state.seats.every((item) => item.ready);
      if (canStart) startGame(state, seat.id);
    }
    if (type === "trpg.rolled") {
      const modifier = Math.max(-10, Math.min(20, Number(data.modifier) || 0));
      const difficulty = Math.max(1, Math.min(40, Number(data.difficulty) || 12));
      const roll = crypto.getRandomValues(new Uint32Array(1))[0] % 20 + 1;
      data = { label: cleanText(data.label || "行动检定", 80), roll, modifier, total: roll + modifier, difficulty, success: roll + modifier >= difficulty };
    }
    recordPlayerEvent(state, {
      seatId: seat.id,
      type,
      data,
      requestId: cleanText(body.request_id || request.headers.get("x-request-id"), 80)
    });
  }
  else return json({ error: "not_found", message: "接口不存在" }, 404, headers);
  await saveState(env.DB, state, expectedVersion);
  await audit(env.DB, gameId, seat.id, action, "ok");
  return json(viewForSeat(state, seat.id, 0), 200, headers);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    const headers = origin && origin !== false ? corsHeaders(origin) : {};
    try { return await handle(request, env); }
    catch (error) { return errorResponse(error, headers); }
  }
};
