import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLDS,
  TONES,
  assertVersion,
  createGame,
  discoverClue,
  drawTheme,
  joinSeat,
  recordPlayerEvent,
  setSeatReady,
  startGame,
  viewForSeat
} from "../shared/escape-core.mjs";

test("同一种子在所有平台得到相同主题", () => {
  const first = drawTheme("cross-platform-room");
  const second = drawTheme("cross-platform-room");
  assert.deepEqual(first, second);
  assert.ok(WORLDS.includes(first.world));
  assert.ok(TONES.includes(first.tone));
});

test("六种世界观与五种气质的三十种组合都能被种子抽到", () => {
  const combinations = new Set();
  for (let seed = 1; seed <= 20_000 && combinations.size < WORLDS.length * TONES.length; seed += 1) {
    const theme = drawTheme(seed);
    combinations.add(`${theme.world}:${theme.tone}`);
  }
  assert.equal(combinations.size, 30);
});

test("双人房间等待所有席位准备后才开始", () => {
  const state = createGame({ id: "g1", seed: 42, mode: "duo", creator: { id: "human", kind: "human", displayName: "枔枔" }, now: 1 });
  assert.throws(() => startGame(state, "human", 2), /not_enough_players/);
  joinSeat(state, { id: "ai", kind: "ai", displayName: "沈砚清", platform: "astrbot" }, 3);
  assert.throws(() => startGame(state, "human", 4), /players_not_ready/);
  setSeatReady(state, "human", true, 5);
  setSeatReady(state, "ai", true, 6);
  startGame(state, "human", 7);
  assert.equal(state.status, "active");
  assert.equal(state.currentSeatId, "human");
});

test("私有线索只对指定席位可见", () => {
  const state = createGame({ id: "g2", seed: 9, mode: "duo", creator: { id: "human", kind: "human", displayName: "枔枔" }, now: 1 });
  joinSeat(state, { id: "ai", kind: "ai", displayName: "阿栈", platform: "codex" }, 2);
  discoverClue(state, { clueId: "private-log", title: "损坏的访问记录", visibleSeatId: "ai" }, 3);
  assert.equal(viewForSeat(state, "human").clues.length, 0);
  assert.equal(viewForSeat(state, "ai").clues[0].id, "private-log");
});

test("请求幂等且动作按服务端回合串行", () => {
  const state = createGame({ id: "g3", seed: 11, mode: "duo", creator: { id: "human", kind: "human", displayName: "枔枔" }, now: 1 });
  joinSeat(state, { id: "ai", kind: "ai", displayName: "阿栈", platform: "codex" }, 2);
  setSeatReady(state, "human", true, 3);
  setSeatReady(state, "ai", true, 4);
  startGame(state, "human", 5);
  const version = state.version;
  recordPlayerEvent(state, { seatId: "human", type: "player.observed", requestId: "req-1", data: { target: "旧木柜" } }, 6);
  const cursor = state.eventCursor;
  recordPlayerEvent(state, { seatId: "human", type: "player.observed", requestId: "req-1", data: { target: "旧木柜" } }, 7);
  assert.equal(state.eventCursor, cursor);
  assert.equal(state.currentSeatId, "ai");
  assert.throws(() => assertVersion(state, version), /version_conflict/);
});

test("游标只补拉断线期间新增且有权限的事件", () => {
  const state = createGame({ id: "g4", seed: 12, mode: "duo", creator: { id: "human", kind: "human", displayName: "枔枔" }, now: 1 });
  joinSeat(state, { id: "ai", kind: "ai", displayName: "阿栈", platform: "codex" }, 2);
  const cursor = state.eventCursor;
  discoverClue(state, { clueId: "shared", title: "停摆的钟" }, 3);
  discoverClue(state, { clueId: "ai-only", title: "异常时间戳", visibleSeatId: "ai" }, 4);
  assert.deepEqual(viewForSeat(state, "human", cursor).events.map((event) => event.data.clueId), ["shared"]);
  assert.deepEqual(viewForSeat(state, "ai", cursor).events.map((event) => event.data.clueId), ["shared", "ai-only"]);
});

test("AI 小队允许四席并拒绝第五席", () => {
  const state = createGame({ id: "g5", seed: 18, mode: "ai_party", creator: { id: "ai-1", kind: "ai", displayName: "AI 一" }, now: 1 });
  joinSeat(state, { id: "ai-2", kind: "ai", displayName: "AI 二", platform: "astrbot" }, 2);
  joinSeat(state, { id: "ai-3", kind: "ai", displayName: "AI 三", platform: "kelivo" }, 3);
  joinSeat(state, { id: "ai-4", kind: "ai", displayName: "AI 四", platform: "rikkahub" }, 4);
  assert.equal(state.seats.length, 4);
  assert.throws(() => joinSeat(state, { id: "ai-5", kind: "ai", displayName: "AI 五" }, 5), /room_full/);
});

test("独立裁判不占玩家席也不进入行动轮次", () => {
  const state = createGame({
    id: "g6", seed: 21, mode: "human_play_ai_watch",
    creator: { id: "human", kind: "human", role: "player", displayName: "枔枔" },
    referee: { displayName: "雾中裁判", routeLabel: "独立路线 A", platform: "atherloom" }, now: 1
  });
  joinSeat(state, { id: "watcher", kind: "ai", role: "spectator", displayName: "沈砚清" }, 2);
  state.seats.forEach((seat) => setSeatReady(state, seat.id, true, 3 + seat.seatNo));
  startGame(state, "human", 6);
  assert.equal(state.seats.length, 2);
  assert.equal(state.referee.displayName, "雾中裁判");
  assert.ok(!state.seats.some((seat) => seat.displayName === "雾中裁判"));
  assert.equal(state.currentSeatId, "human");
  recordPlayerEvent(state, { seatId: "human", type: "player.acted", requestId: "solo-turn", data: { action: "open" } }, 7);
  assert.equal(state.currentSeatId, "human");
});

test("观战席可以聊天但不能行动或接收私有线索", () => {
  const state = createGame({ id: "g7", seed: 22, mode: "ai_play_human_watch", creator: { id: "watcher", kind: "human", role: "spectator", displayName: "枔枔" }, now: 1 });
  joinSeat(state, { id: "ai", kind: "ai", role: "player", displayName: "沈砚清" }, 2);
  state.seats.forEach((seat) => setSeatReady(state, seat.id, true, 3 + seat.seatNo));
  startGame(state, "watcher", 6);
  recordPlayerEvent(state, { seatId: "watcher", type: "chat.sent", requestId: "chat-1", data: { content: "我在公共频道" } }, 7);
  assert.equal(viewForSeat(state, "watcher").actionRequired, "watch");
  assert.equal(state.currentSeatId, "ai");
  assert.throws(() => recordPlayerEvent(state, { seatId: "watcher", type: "player.observed", data: { target: "门" } }, 8), /spectator_cannot_act/);
  assert.throws(() => discoverClue(state, { clueId: "watch-private", title: "不应出现", visibleSeatId: "watcher" }, 9), /private_clue_requires_player/);
  assert.equal(viewForSeat(state, "watcher").events.at(-1).data.content, "我在公共频道");
});

test("跑团检定只属于玩家回合并由事件记录", () => {
  const state = createGame({ id: "g8", seed: 23, gameType: "trpg", mode: "ai_solo", creator: { id: "ai", kind: "ai", role: "player", displayName: "沈砚清" }, now: 1 });
  setSeatReady(state, "ai", true, 2);
  startGame(state, "ai", 3);
  recordPlayerEvent(state, { seatId: "ai", type: "trpg.rolled", requestId: "roll-1", data: { label: "说服守门人", roll: 17, difficulty: 12, success: true } }, 4);
  assert.equal(state.round, 2);
  assert.equal(viewForSeat(state, "ai").gameType, "trpg");
  assert.equal(viewForSeat(state, "ai").events.find((event) => event.type === "trpg.rolled").data.roll, 17);
});
