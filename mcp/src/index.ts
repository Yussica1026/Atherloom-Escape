#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadHttpConfig, loadRelayConfig } from "./config.js";
import { createHttpServer, listenHttp } from "./http.js";
import { createEscapeMcpServer } from "./mcp-server.js";

async function main(): Promise<void> {
  const relayConfig = loadRelayConfig();
  if (process.argv.includes("--http")) {
    const httpConfig = loadHttpConfig();
    const server = createHttpServer(relayConfig, httpConfig);
    await listenHttp(server, httpConfig);
    console.error(`Atherloom Escape MCP: http://${httpConfig.host}:${httpConfig.port}/mcp`);
    const stop = () => server.close();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  serveStdio(() => createEscapeMcpServer(relayConfig), { onerror: error => console.error(`[stdio] ${error.message}`) });
}

main().catch(error => { console.error(error instanceof Error ? error.message : "MCP 启动失败"); process.exitCode = 1; });
