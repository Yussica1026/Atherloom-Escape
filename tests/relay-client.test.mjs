import test from "node:test";
import assert from "node:assert/strict";
import { EscapeRelayClient, RelayError } from "../web/relay-client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Relay client trims URL and sends bearer/version", async () => {
  const calls = [];
  const client = new EscapeRelayClient({ baseUrl: "https://relay.example///", fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ version: 3 });
  } });
  await client.sendEvent("game/a", "secret", 2, "chat.sent", { content: "hello" }, "req-1");
  assert.equal(calls[0].url, "https://relay.example/v1/escape/games/game%2Fa/events");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    expected_version: 2,
    type: "chat.sent",
    data: { content: "hello" },
    request_id: "req-1"
  });
});

test("Relay client exposes service errors without leaking response internals", async () => {
  const client = new EscapeRelayClient({ fetchImpl: async () => jsonResponse({ error: "room_full", message: "房间已满" }, 409) });
  await assert.rejects(client.joinGame({ invite_code: "AAAA2222" }), (error) => {
    assert.ok(error instanceof RelayError);
    assert.equal(error.code, "room_full");
    assert.equal(error.status, 409);
    assert.equal(error.message, "房间已满");
    return true;
  });
});

test("Relay client turns fetch failures into a stable network error", async () => {
  const client = new EscapeRelayClient({ fetchImpl: async () => { throw new TypeError("offline"); } });
  await assert.rejects(client.health(), (error) => error.code === "network_error");
});
