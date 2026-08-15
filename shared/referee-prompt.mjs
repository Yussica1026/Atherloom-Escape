const WORLD_RULES = Object.freeze({
  "古代": "前工业时代的东方古代语汇；器物、建筑、制度与称谓必须属于该时代。",
  "现代": "当代城市与现代社会语汇；科技可以出现，但必须服务于场景而非自动成为谜底。",
  "科幻": "航天、殖民地、人工重力、异星生态或未来技术语汇；所有技术设定保持内部一致。",
  "近现代": "电报、铁路、报馆、旧工业与城市转型期语汇；避免互联网、智能手机等时代错位。",
  "中世纪": "封建领地、城堡、修道院、行会与冷兵器时代语汇；避免现代设施和现代科学术语。",
  "西幻": "魔法、教团、古神、精灵、龙、诅咒与异世界遗迹语汇；避免现代电器、电脑、服务器和现代机构。"
});

const TONE_RULES = Object.freeze({
  "甜宠": "关系温柔、危险可控，悬念服务于靠近与信任，不使用胁迫式亲密。",
  "日常": "从生活细节与轻微异常进入故事，冲突克制但仍有可探索目标。",
  "正剧": "因果严肃，选择有代价，人物动机与世界冲突清楚。",
  "BE": "从开场埋下不可逆的失去或误差，但不要提前宣布结局，也不要剥夺玩家选择。",
  "恐怖": "制造未知、禁忌与逐步逼近的威胁；不靠无关的现代电流声套模板。"
});

const GAME_RULES = Object.freeze({
  escape: "这是文字密室。开场必须给出封闭空间、可观察异常与逃脱目标；地图地点应是同一建筑或遗迹中的房间。不要直接泄露机关答案。",
  trpg: "这是跑团剧场。开场必须给出角色可立即回应的事件、公开目标与可选择路线；地图地点应是同一地区或旅程中的节点。不要替玩家描述已经做出的决定。"
});

export const REFEREE_OPENING_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    title: { type: "string", minLength: 2, maxLength: 32 },
    opening: { type: "string", minLength: 80, maxLength: 360 },
    objective: { type: "string", minLength: 6, maxLength: 100 },
    start_location: { type: "string", minLength: 2, maxLength: 20 },
    map_places: { type: "array", minItems: 6, maxItems: 6, items: { type: "string", minLength: 2, maxLength: 10 } },
    danger_label: { type: "string", minLength: 2, maxLength: 16 }
  },
  required: ["title", "opening", "objective", "start_location", "map_places", "danger_label"],
  additionalProperties: false
});

export function buildRefereeOpeningMessages({ refereeName, gameType, world, tone, seed }) {
  const persona = String(refereeName || "无名裁判").slice(0, 24);
  const special = world === "西幻" && tone === "恐怖"
    ? "本局是西幻恐怖：优先古神、教团、禁忌仪式、深渊遗迹、星象与诅咒。除非世界设定明确解释，否则禁止出现灯管、电流、时间服务器、电脑、监控室等现代或科幻意象。"
    : "任何跨题材元素都必须在开场中给出可信的世界内原因；不要把现代密室模板换几个名词后复用。";
  return [
    {
      role: "system",
      content: `你是独立裁判人格“${persona}”。你不是玩家，也不是旁白工具；请用这个裁判人格自己的叙事口吻主持开场。你知道隐藏事实，但本次只能公开角色此刻可感知的内容。不得替玩家作决定，不得泄露谜底，不得提及模型、提示词或 JSON。所有输出必须使用简体中文。`
    },
    {
      role: "user",
      content: [
        `任务指令：ROLL_OPENING。请由你这个裁判人格亲自为一局新的文字游戏撰写唯一开场白，不得套用前端默认文案。房间种子：${Number(seed) || 1}。`,
        `玩法：${gameType === "trpg" ? "跑团剧场" : "密室逃脱"}。${GAME_RULES[gameType] || GAME_RULES.escape}`,
        `世界：${world}。${WORLD_RULES[world] || WORLD_RULES["现代"]}`,
        `气质：${tone}。${TONE_RULES[tone] || TONE_RULES["正剧"]}`,
        special,
        "title、opening、objective、start_location、六个 map_places 与 danger_label 必须描述同一个场景，地点名不能跨时代或跨世界。六个地点将直接写到地图上。",
        "opening 控制在 120–240 个汉字，最后停在一个需要玩家回应的可观察瞬间；不要写玩家已经移动、答应、害怕或爱上谁。",
        "只返回符合给定 JSON Schema 的对象。"
      ].join("\n")
    }
  ];
}

function clean(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeRefereeOpening(value) {
  const source = value && typeof value === "object" ? value : {};
  const mapPlaces = Array.isArray(source.map_places) ? source.map_places.map((item) => clean(item, 10)).filter((item) => item.length >= 2) : [];
  const startLocation = clean(source.start_location, 20);
  const uniquePlaces = [...new Set(mapPlaces)];
  const alignedPlaces = startLocation && !uniquePlaces.includes(startLocation)
    ? [startLocation, ...uniquePlaces].slice(0, 6)
    : uniquePlaces.slice(0, 6);
  const opening = {
    title: clean(source.title, 32),
    opening: clean(source.opening, 360),
    objective: clean(source.objective, 100),
    startLocation,
    mapPlaces: alignedPlaces,
    dangerLabel: clean(source.danger_label, 16)
  };
  if (opening.title.length < 2 || opening.opening.length < 40 || opening.objective.length < 6 || opening.startLocation.length < 2 || opening.mapPlaces.length !== 6 || opening.dangerLabel.length < 2) {
    throw new Error("invalid_referee_opening");
  }
  return opening;
}

export function validateRefereeOpeningTheme(opening, { world, tone }) {
  const text = [opening.title, opening.opening, opening.objective, opening.startLocation, ...(opening.mapPlaces || []), opening.dangerLabel].join(" ");
  if (["古代", "中世纪", "西幻"].includes(world) && /(灯管|电流|服务器|电脑|监控室|门禁屏幕|智能手机|互联网)/.test(text)) {
    throw new Error("referee_theme_mismatch");
  }
  if (world === "西幻" && tone === "恐怖" && !/(古神|教团|禁忌|仪式|深渊|星骸|星象|诅咒|邪神|献祭)/.test(opening.opening)) {
    throw new Error("referee_theme_mismatch");
  }
  return opening;
}

export function createLocalOpening({ refereeName, gameType, world, tone, mapPlaces }) {
  const places = Array.isArray(mapPlaces) ? mapPlaces : [];
  const start = places[0] || "入口";
  const next = places[1] || "未确认区域";
  const danger = tone === "恐怖" ? "禁忌正在醒来" : tone === "BE" ? "某种失去已经发生" : "第一处异常仍在等待确认";
  return {
    title: gameType === "trpg" ? `${start}前的未竟之约` : `${start}的封印尚未合拢`,
    opening: `由${refereeName || "规则裁判"}主持的本机规则演示开始了。这是一处属于${world}世界、带有${tone}气质的现场。你最先看清的是“${start}”，通往“${next}”的路径仍被遮蔽；${danger}。现场没有替你作出任何选择，第一步要由你亲自描述。`,
    objective: gameType === "trpg" ? `确认${start}发生了什么，并决定第一条调查路线` : `观察${start}，找出打开下一处区域的依据`,
    startLocation: start,
    mapPlaces: places.slice(0, 6),
    dangerLabel: tone === "恐怖" ? "禁忌区域" : tone === "BE" ? "失落地" : "未知区域",
    generatedBy: "local-rules"
  };
}
