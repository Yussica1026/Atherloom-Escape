import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_PLACES, generateMapModel, mapSvgMarkup } from "../web/map-generator.js";

test("同一房间种子在所有设备生成相同地图", () => {
  const input = { seed: 20260815, world: "西幻", tone: "恐怖", gameType: "escape" };
  assert.deepEqual(generateMapModel(input), generateMapModel(input));
});

test("新房间种子会改变地图结构", () => {
  const signatures = new Set(Array.from({ length: 20 }, (_, index) => {
    const model = generateMapModel({ seed: index + 1, world: "西幻", tone: "恐怖", gameType: "escape" });
    return JSON.stringify({ nodes: model.nodes.map(({ x, y, label }) => ({ x, y, label })), edges: model.edges });
  }));
  assert.ok(signatures.size >= 16, `只有 ${signatures.size} 种地图`);
});

test("地图地点与世界和玩法匹配", () => {
  const escape = generateMapModel({ seed: 7, world: "西幻", tone: "恐怖", gameType: "escape" });
  const trpg = generateMapModel({ seed: 7, world: "中世纪", tone: "正剧", gameType: "trpg" });
  assert.equal(escape.kind, "floorplan");
  assert.equal(trpg.kind, "route");
  assert.ok(escape.nodes.every((node) => WORLD_PLACES["西幻"].escape.includes(node.label)));
  assert.ok(trpg.nodes.every((node) => WORLD_PLACES["中世纪"].trpg.includes(node.label)));
  assert.match(mapSvgMarkup(escape), /黑星祭坛|古神|教团|深渊|封印|禁书|星骸|圣堂/);
});

test("裁判生成的地点名会进入同局地图且被 XML 转义", () => {
  const places = ["旧神祭坛", "群星墓室", "荆棘回廊", "无光圣堂", "教团藏窖", "深渊之门"];
  const model = generateMapModel({ seed: 99, world: "西幻", tone: "恐怖", gameType: "escape", mapPlaces: [...places, "<script>"] });
  assert.ok(model.nodes.some((node) => places.includes(node.label)));
  assert.equal(model.nodes.find((node) => node.id === model.startId).label, places[0]);
  assert.doesNotMatch(mapSvgMarkup(model), /<script>/);
});
