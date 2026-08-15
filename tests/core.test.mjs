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
