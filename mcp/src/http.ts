import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler, type NodeIncomingMessageLike } from "@modelcontextprotocol/node";
import type { HttpConfig, RelayConfig } from "./config.js";
import { createEscapeMcpServer } from "./mcp-server.js";

function tokenMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}

function reply(res: import("node:http").ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export function createHttpServer(relayConfig: RelayConfig, httpConfig: HttpConfig): Server {
  const handler = createMcpHandler(() => createEscapeMcpServer(relayConfig), {
    legacy: "stateless",
    responseMode: "auto",
    keepAliveMs: 15_000,
    onerror: error => console.error(`[mcp] ${error.message}`)
  });
  const nodeHandler = toNodeHandler(handler, { onerror: error => console.error(`[http] ${error.message}`) });
  const validateHost = hostHeaderValidation(httpConfig.allowedHosts);
  const validateOrigin = originValidation(httpConfig.allowedOrigins);

  const server = createServer(async (req, res) => {
    const path = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
    if (path === "/health" && req.method === "GET") return reply(res, 200, { ok: true, service: "atherloom-escape-mcp" });
    if (path !== "/mcp") return reply(res, 404, { error: "not_found" });
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "authorization,content-type,accept,mcp-protocol-version,mcp-session-id");
      res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") { res.writeHead(204, { "cache-control": "no-store" }); return res.end(); }
    if (!tokenMatches(typeof req.headers.authorization === "string" ? req.headers.authorization : undefined, httpConfig.accessToken)) {
      res.setHeader("www-authenticate", 'Bearer realm="atherloom-escape-mcp"');
      return reply(res, 401, { error: "unauthorized" });
    }
    if (Number(req.headers["content-length"] || 0) > 1_048_576) return reply(res, 413, { error: "request_too_large" });
    await nodeHandler(req as unknown as NodeIncomingMessageLike, res);
  });
  server.on("close", () => { void handler.close(); });
  return server;
}

export async function listenHttp(server: Server, config: HttpConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => { server.off("error", reject); resolve(); });
  });
}
