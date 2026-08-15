import test from "node:test";
import assert from "node:assert/strict";
import { loadRelayConfig } from "../config.js";

test("公网 Relay 强制使用 HTTPS", () => {
  const previousUrl = process.env.ATHERLOOM_ESCAPE_RELAY_URL;
  const previousToken = process.env.ATHERLOOM_CLIENT_TOKEN;
  process.env.ATHERLOOM_ESCAPE_RELAY_URL = "http://example.com";
  process.env.ATHERLOOM_CLIENT_TOKEN = "secret";
  assert.throws(loadRelayConfig, /HTTPS/);
  process.env.ATHERLOOM_ESCAPE_RELAY_URL = previousUrl;
  process.env.ATHERLOOM_CLIENT_TOKEN = previousToken;
});

test("本机 Relay 允许 HTTP", () => {
  const previousUrl = process.env.ATHERLOOM_ESCAPE_RELAY_URL;
  const previousToken = process.env.ATHERLOOM_CLIENT_TOKEN;
  process.env.ATHERLOOM_ESCAPE_RELAY_URL = "http://127.0.0.1:8787";
  process.env.ATHERLOOM_CLIENT_TOKEN = "secret";
  assert.deepEqual(loadRelayConfig(), { baseUrl: "http://127.0.0.1:8787", clientToken: "secret" });
  process.env.ATHERLOOM_ESCAPE_RELAY_URL = previousUrl;
  process.env.ATHERLOOM_CLIENT_TOKEN = previousToken;
});
