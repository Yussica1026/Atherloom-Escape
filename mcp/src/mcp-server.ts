import { randomUUID } from "node:crypto";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { RelayConfig } from "./config.js";
import { EscapeRelayClient, RelayError } from "./relay-client.js";

const gameId = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const outputSchema = z.object({ ok: z.boolean(), data: z.record(z.string(), z.unknown()).optional(), error: z.record(z.string(), z.unknown()).optional() });

function result(ok: boolean, data: Record<string, unknown>, isError = false): CallToolResult {
  const value = ok ? { ok, data } : { ok, error: data };
  const base = { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value };
  return isError ? { ...base, isError: true } : base;
}

async function run(operation: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try { return result(true, await operation()); }
  catch (error) { return result(false, error instanceof RelayError ? error.problem : { code: "connector_internal_error" }, true); }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const mutate = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export function createEscapeMcpServer(config: RelayConfig): McpServer {
  const relay = new EscapeRelayClient(config);
  const server = new McpServer({ name: "atherloom-escape-mcp", version: "0.1.0" });

  server.registerTool("atherloom_escape_create", {
    title: "创建密室或跑团房间",
    description: "创建 1–4 席密室/跑团房间并随机抽取世界与气质。裁判人格和路线独立于游玩人格，只保存路线标签，不返回任何模型密钥。",
    inputSchema: z.object({
      game_type: z.enum(["escape", "trpg"]).default("escape"),
      mode: z.enum(["ai_solo", "duo", "ai_party", "mixed_party", "human_play_ai_watch", "ai_play_human_watch"]),
      role: z.enum(["player", "spectator"]).default("player"),
      display_name: z.string().trim().min(1).max(24),
      referee_name: z.string().trim().min(1).max(24).default("规则裁判"),
      referee_route: z.string().trim().min(1).max(40).default("独立裁判路线")
    }), outputSchema, annotations: mutate
  }, async ({ game_type, mode, role, display_name, referee_name, referee_route }) => run(() => relay.create(game_type, mode, role, display_name, referee_name, referee_route)));

  server.registerTool("atherloom_escape_join", {
    title: "加入文字密室",
    description: "使用人类转交的一次性邀请码入席。入席只授予当前游戏席位，不开放用户隐私、其他人格记忆或未发现谜底。",
    inputSchema: z.object({ invite_code: z.string().trim().min(8).max(16), display_name: z.string().trim().min(1).max(24), role: z.enum(["player", "spectator"]).default("player") }), outputSchema, annotations: mutate
  }, async ({ invite_code, display_name, role }) => run(() => relay.join(invite_code, display_name, role)));

  server.registerTool("atherloom_escape_state", {
    title: "读取自己的密室视图",
    description: "读取当前 AI 有权知道的房间状态、公开线索、自己的私有线索、事件游标和下一步动作。不会返回其他席位的私有线索或未发现答案。",
    inputSchema: z.object({ game_id: gameId, after: z.number().int().min(0).default(0) }), outputSchema, annotations: readOnly
  }, async ({ game_id, after }) => run(() => relay.state(game_id, after)));

  server.registerTool("atherloom_escape_wait", {
    title: "等待密室事件或自己的回合",
    description: "短轮询直到出现新事件、轮到自己、游戏结束或本次等待超时。宿主仍需支持 Agent 循环或后台任务，MCP 本身不能自行唤醒已经结束推理的模型。",
    inputSchema: z.object({ game_id: gameId, after: z.number().int().min(0), wait_seconds: z.number().int().min(0).max(25).default(20) }), outputSchema, annotations: readOnly
  }, async ({ game_id, after, wait_seconds }) => run(() => relay.wait(game_id, after, wait_seconds)));

  server.registerTool("atherloom_escape_ready", {
    title: "确认密室准备状态",
    description: "确认或取消当前 AI 的准备状态。expected_version 必须来自最新状态，避免覆盖其他平台刚发生的变化。",
    inputSchema: z.object({ game_id: gameId, expected_version: z.number().int().min(1), ready: z.boolean().default(true) }), outputSchema, annotations: mutate
  }, async ({ game_id, expected_version, ready }) => run(() => relay.ready(game_id, expected_version, ready)));

  server.registerTool("atherloom_escape_start", {
    title: "开始文字密室",
    description: "全部必要席位到齐且已准备后开始游戏。由 Relay 决定第一位行动者。",
    inputSchema: z.object({ game_id: gameId, expected_version: z.number().int().min(1) }), outputSchema, annotations: mutate
  }, async ({ game_id, expected_version }) => run(() => relay.start(game_id, expected_version)));

  server.registerTool("atherloom_escape_say", {
    title: "发送现场聊天",
    description: "向房间公共聊天频道发送消息。玩家和观战者都能聊天，交谈不抢占行动回合，也不会授予私有线索权限。",
    inputSchema: z.object({ game_id: gameId, expected_version: z.number().int().min(1), content: z.string().trim().min(1).max(2000) }), outputSchema, annotations: mutate
  }, async ({ game_id, expected_version, content }) => run(() => relay.event(game_id, expected_version, "chat.sent", { content }, randomUUID())));

  server.registerTool("atherloom_escape_roll", {
    title: "请求跑团检定",
    description: "轮到当前跑团玩家时请求一次服务端 d20 检定。骰点由 Relay 生成；观战席不能代替玩家掷骰。",
    inputSchema: z.object({ game_id: gameId, expected_version: z.number().int().min(1), label: z.string().trim().min(1).max(80), modifier: z.number().int().min(-10).max(20).default(0), difficulty: z.number().int().min(1).max(40).default(12) }), outputSchema, annotations: mutate
  }, async ({ game_id, expected_version, label, modifier, difficulty }) => run(() => relay.event(game_id, expected_version, "trpg.rolled", { label, modifier, difficulty }, randomUUID())));

  server.registerTool("atherloom_escape_observe", {
    title: "观察密室目标",
    description: "轮到当前 AI 时观察一个地点、物品或现象。真实结果由服务端裁判返回，不能自行声称发现未返回的线索。",
    inputSchema: z.object({ game_id: gameId, expected_version: z.number().int().min(1), target: z.string().trim().min(1).max(240) }), outputSchema, annotations: mutate
  }, async ({ game_id, expected_version, target }) => run(() => relay.event(game_id, expected_version, "player.observed", { target }, randomUUID())));

  server.registerTool("atherloom_escape_act", {
    title: "执行密室行动",
    description: "轮到当前 AI 时提交移动、组合、使用物品或输入答案等动作。Relay 裁判拥有唯一真实状态，拒绝用自然语言直接改写结果。",
    inputSchema: z.object({ game_id: gameId, expected_version: z.number().int().min(1), action: z.string().trim().min(1).max(80), target: z.string().trim().max(240).default(""), value: z.string().trim().max(240).default("") }), outputSchema, annotations: mutate
  }, async ({ game_id, expected_version, action, target, value }) => run(() => relay.event(game_id, expected_version, "player.acted", { action, target, value }, randomUUID())));

  return server;
}
