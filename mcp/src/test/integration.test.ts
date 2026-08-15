import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHttpServer } from "../http.js";
import { startMockRelay } from "./mock-relay.js";

const ACCESS_TOKEN = "escape_mcp_test_access_token_abcdefghijklmnopqrstuvwxyz";

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const envelope = result.structuredContent as { ok: boolean; data: Record<string, unknown> };
  assert.equal(envelope.ok, true);
  return envelope.data;
}

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  return { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ...extra };
}

test("STDIO：官方 MCP 客户端发现工具并完成建局、准备、观察", async () => {
  const relay = await startMockRelay();
  const entry = fileURLToPath(new URL("../index.js", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: cleanEnv({ ATHERLOOM_ESCAPE_RELAY_URL: relay.url, ATHERLOOM_CLIENT_TOKEN: relay.token }), stderr: "pipe" });
  const client = new Client({ name: "escape-stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 9);
    assert.ok(tools.tools.some(tool => tool.name === "atherloom_escape_wait"));
    const created = structured(await client.callTool({ name: "atherloom_escape_create", arguments: { mode: "ai_solo", display_name: "阿栈" } }));
    assert.equal(created.invite_code, "ABCD-2345");
    const state = structured(await client.callTool({ name: "atherloom_escape_state", arguments: { game_id: "escape_mock", after: 0 } }));
    assert.equal(state.actionRequired, "act");
    const ready = structured(await client.callTool({ name: "atherloom_escape_ready", arguments: { game_id: "escape_mock", expected_version: 1, ready: true } }));
    assert.equal(ready.version, 2);
    const observed = structured(await client.callTool({ name: "atherloom_escape_observe", arguments: { game_id: "escape_mock", expected_version: 2, target: "停摆的钟" } }));
    assert.equal(observed.eventCursor, 4);
  } finally {
    await client.close().catch(() => undefined);
    await relay.close();
  }
});

test("Streamable HTTP：Bearer 鉴权、恶意 Origin 拒绝和工具调用", async () => {
  const relay = await startMockRelay();
  const server = createHttpServer({ baseUrl: relay.url, clientToken: relay.token }, { host: "127.0.0.1", port: 0, accessToken: ACCESS_TOKEN, allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: ["http://127.0.0.1"] });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: "escape-http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } } });
  try {
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { origin: "https://evil.example", authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" }, body: "{}" })).status, 403);
    await client.connect(transport);
    const state = structured(await client.callTool({ name: "atherloom_escape_state", arguments: { game_id: "escape_mock", after: 0 } }));
    assert.equal(state.selfSeatId, "seat_self");
  } finally {
    await client.close().catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await relay.close();
  }
});
