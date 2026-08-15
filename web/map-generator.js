import { seededRandom } from "../shared/escape-core.mjs";

export const WORLD_PLACES = Object.freeze({
  "古代": {
    escape: ["影壁", "偏殿", "石庭", "密阁", "地窖", "回廊", "藏经阁", "封泥库"],
    trpg: ["古渡", "驿道", "荒寺", "竹林", "王城", "边关", "盐泽", "旧陵"]
  },
  "现代": {
    escape: ["入口室", "控制间", "档案库", "维修道", "值班室", "封存区", "货梯", "监控室"],
    trpg: ["旧城区", "地铁线", "港口", "医院", "广播塔", "天台", "公寓", "地下街"]
  },
  "科幻": {
    escape: ["气闸", "观测舱", "核心井", "休眠舱", "维护环", "零重力仓", "反应室", "导航桥"],
    trpg: ["跃迁门", "殖民环", "失联站", "星云带", "回收港", "月面遗址", "冰卫星", "信标阵"]
  },
  "近现代": {
    escape: ["票务厅", "电报房", "旧月台", "行李库", "锅炉间", "暗廊", "放映室", "站长室"],
    trpg: ["铁路镇", "旧报馆", "租界", "码头", "山道", "废厂", "戏院", "邮政局"]
  },
  "中世纪": {
    escape: ["门楼", "礼拜堂", "地牢", "军械库", "塔梯", "内庭", "墓窖", "领主厅"],
    trpg: ["雾林", "领主堡", "修道院", "古战场", "石桥", "村落", "沼泽", "烽火塔"]
  },
  "西幻": {
    escape: ["黑星祭坛", "溺亡回廊", "星骸密室", "教团藏窖", "无月圣堂", "封印门", "深渊井", "禁书塔"],
    trpg: ["月影林", "古神遗迹", "遗忘塔", "裂隙荒原", "沉没圣城", "教团营地", "龙骨山", "无光湖"]
  }
});

export const TONE_MARKERS = Object.freeze({
  "甜宠": "约定地点",
  "日常": "补给点",
  "正剧": "转折点",
  "BE": "失落地",
  "恐怖": "禁忌区域"
});

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function cleanPlaces(places, fallback) {
  const cleaned = (places || []).map((item) => String(item || "").trim().slice(0, 10)).filter(Boolean);
  const unique = [...new Set(cleaned)];
  if (unique.length >= 6) return unique.slice(0, 8);
  return [...new Set([...unique, ...fallback])].slice(0, 8);
}

function floorplan(seed, places, tone) {
  const random = seededRandom(`${seed}:escape-map`);
  const columns = 4;
  const rows = 3;
  const wanted = Math.min(places.length, 6 + Math.floor(random() * 3));
  const start = { column: Math.floor(random() * columns), row: Math.floor(random() * rows) };
  const cells = [start];
  const keys = new Set([`${start.column}:${start.row}`]);
  const edges = [];
  while (cells.length < wanted) {
    const candidates = [];
    for (const cell of cells) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const column = cell.column + dx;
        const row = cell.row + dy;
        const key = `${column}:${row}`;
        if (column >= 0 && column < columns && row >= 0 && row < rows && !keys.has(key)) {
          candidates.push({ from: cell, to: { column, row }, key });
        }
      }
    }
    if (!candidates.length) break;
    const selected = candidates[Math.floor(random() * candidates.length)];
    keys.add(selected.key);
    cells.push(selected.to);
    edges.push({ from: selected.from, to: selected.to });
  }
  const labels = [places[0], ...shuffle(places.slice(1), random)];
  const nodes = cells.map((cell, index) => ({
    id: index,
    x: 62 + cell.column * 128,
    y: 55 + cell.row * 104,
    width: 108,
    height: 82,
    label: labels[index % labels.length]
  }));
  const nodeAt = (cell) => nodes.find((node) => node.x === 62 + cell.column * 128 && node.y === 55 + cell.row * 104);
  return {
    kind: "floorplan",
    nodes,
    edges: edges.map((edge) => ({ from: nodeAt(edge.from).id, to: nodeAt(edge.to).id })),
    startId: 0,
    dangerId: 1 + Math.floor(random() * Math.max(1, nodes.length - 1)),
    dangerLabel: TONE_MARKERS[tone] || "未知区域",
    metric: `${nodes.length} 室`,
    caption: "房间结构由本局种子生成"
  };
}

function routeMap(seed, places, tone) {
  const random = seededRandom(`${seed}:trpg-map`);
  const labels = [places[0], ...shuffle(places.slice(1), random)].slice(0, 6);
  const nodes = labels.map((label, index) => ({
    id: index,
    x: 58 + index * 96,
    y: 72 + Math.floor(random() * 250),
    label
  }));
  return {
    kind: "route",
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: index, to: node.id })),
    startId: 0,
    dangerId: 2 + Math.floor(random() * Math.max(1, nodes.length - 2)),
    dangerLabel: TONE_MARKERS[tone] || "未知区域",
    metric: `${nodes.length} 地`,
    caption: "旅途路线由本局种子生成"
  };
}

export function generateMapModel({ seed, world, tone, gameType, mapPlaces = [] }) {
  const fallback = WORLD_PLACES[world]?.[gameType] || WORLD_PLACES["现代"][gameType] || WORLD_PLACES["现代"].escape;
  const places = cleanPlaces(mapPlaces, fallback);
  return gameType === "trpg" ? routeMap(seed, places, tone) : floorplan(seed, places, tone);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

export function mapSvgMarkup(model) {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const center = (node) => ({ x: node.x + (node.width || 0) / 2, y: node.y + (node.height || 0) / 2 });
  const connections = model.edges.map((edge) => {
    const from = center(byId.get(edge.from));
    const to = center(byId.get(edge.to));
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`;
  }).join("");
  const danger = byId.get(model.dangerId);
  const start = center(byId.get(model.startId));
  if (model.kind === "route") {
    const nodes = model.nodes.map((node) => `<g class="plan-node${node.id === model.dangerId ? " plan-node--danger" : ""}"><circle cx="${node.x}" cy="${node.y}" r="19"/><text x="${node.x}" y="${node.y + 39}">${escapeXml(node.label)}</text></g>`).join("");
    return `<g class="plan-contours"><path d="M32 108c112-92 214 72 322-4s164-31 218 39M20 286c95-66 184 54 294-14s190-51 274 18"/></g><g class="plan-routes">${connections}</g><g class="plan-labels">${nodes}</g><text class="plan-danger-label" x="${danger.x}" y="${Math.max(22, danger.y - 28)}">${escapeXml(model.dangerLabel)}</text><circle class="plan-position" cx="${start.x}" cy="${start.y}" r="8"/>`;
  }
  const rooms = model.nodes.map((node) => `<g class="plan-room${node.id === model.dangerId ? " plan-room--danger" : ""}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/><text x="${node.x + node.width / 2}" y="${node.y + node.height / 2 + 4}">${escapeXml(node.label)}</text></g>`).join("");
  return `<g class="plan-grid"><path d="M30 30H570M30 80H570M30 130H570M30 180H570M30 230H570M30 280H570M30 330H570M30 380H570M50 20V390M100 20V390M150 20V390M200 20V390M250 20V390M300 20V390M350 20V390M400 20V390M450 20V390M500 20V390M550 20V390"/></g><g class="plan-routes">${connections}</g><g class="plan-labels">${rooms}</g><text class="plan-danger-label" x="${danger.x + danger.width / 2}" y="${Math.max(22, danger.y - 9)}">${escapeXml(model.dangerLabel)}</text><circle class="plan-position" cx="${start.x}" cy="${start.y}" r="8"/>`;
}
