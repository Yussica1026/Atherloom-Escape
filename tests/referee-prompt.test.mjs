import test from "node:test";
import assert from "node:assert/strict";
import { buildRefereeOpeningMessages, normalizeRefereeOpening, validateRefereeOpeningTheme } from "../shared/referee-prompt.mjs";

test("裁判开场提示词包含人格、玩法、主题和禁止错位约束", () => {
  const messages = buildRefereeOpeningMessages({ refereeName: "鸦钟", gameType: "escape", world: "西幻", tone: "恐怖", seed: 42 });
  const prompt = messages.map((message) => message.content).join("\n");
  assert.match(prompt, /独立裁判人格“鸦钟”/);
  assert.match(prompt, /ROLL_OPENING/);
  assert.match(prompt, /裁判人格亲自.*撰写唯一开场白/);
  assert.match(prompt, /密室逃脱/);
  assert.match(prompt, /西幻恐怖/);
  assert.match(prompt, /古神、教团、禁忌仪式、深渊遗迹/);
  assert.match(prompt, /禁止出现灯管、电流、时间服务器、电脑、监控室/);
  assert.match(prompt, /不得替玩家作决定/);
});

test("裁判结构化开场会清理字段并保留六个唯一地点", () => {
  const opening = normalizeRefereeOpening({
    title: " 黑星沉入钟楼 ",
    opening: "无月圣堂的钟已经沉默了三百年，今晚却从地底敲响。门缝里涌出的不是风，而是一串念诵你名字的古老祷词。墙上六幅圣像同时转过脸去，只有封印门后的星光仍在缓慢呼吸；门前留着一枚刚刚湿润的黑色手印，等待你决定先看向哪里。",
    objective: "确认黑色手印的来历，并找到离开无月圣堂的第一条路径",
    start_location: "无月圣堂",
    map_places: ["无月圣堂", "黑星祭坛", "教团藏窖", "溺亡回廊", "星骸密室", "深渊井"],
    danger_label: "古神注视"
  });
  assert.equal(opening.mapPlaces.length, 6);
  assert.equal(opening.startLocation, "无月圣堂");
});

test("不完整的裁判输出不会被当作真实开场", () => {
  assert.throws(() => normalizeRefereeOpening({ title: "短", opening: "不够", map_places: [] }), /invalid_referee_opening/);
});

test("西幻恐怖开场会拒绝现代设备与缺失恐怖母题的结果", () => {
  const base = normalizeRefereeOpening({
    title: "黑星之下",
    opening: "古神教团在无月圣堂完成了禁忌仪式，深渊里的低语正沿着石壁靠近，而祭坛上的封印只剩最后一道裂痕。你仍站在门外，尚未作出任何选择。",
    objective: "调查古神仪式并找到封印裂痕的来源",
    start_location: "无月圣堂",
    map_places: ["无月圣堂", "黑星祭坛", "溺亡回廊", "教团藏窖", "深渊井", "禁书塔"],
    danger_label: "古神苏醒处"
  });
  assert.equal(validateRefereeOpeningTheme(base, { world: "西幻", tone: "恐怖" }), base);
  assert.throws(() => validateRefereeOpeningTheme({ ...base, opening: `${base.opening} 监控室的电脑仍然亮着。` }, { world: "西幻", tone: "恐怖" }), /referee_theme_mismatch/);
  assert.throws(() => validateRefereeOpeningTheme({ ...base, opening: "一座普通城堡安静地立在山谷里，石门紧闭，没有人知道里面发生了什么。" }, { world: "西幻", tone: "恐怖" }), /referee_theme_mismatch/);
});
