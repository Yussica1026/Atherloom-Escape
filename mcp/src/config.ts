export type RelayConfig = { baseUrl: string; clientToken: string };
export type HttpConfig = { host: string; port: number; accessToken: string; allowedHosts: string[]; allowedOrigins: string[] };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function csv(name: string, fallback: string[]): string[] {
  return (process.env[name] || "").split(",").map(value => value.trim()).filter(Boolean).concat(fallback).filter((value, index, all) => all.indexOf(value) === index);
}

export function loadRelayConfig(): RelayConfig {
  const baseUrl = required("ATHERLOOM_ESCAPE_RELAY_URL").replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error("公网 Relay 必须使用 HTTPS");
  return { baseUrl, clientToken: required("ATHERLOOM_CLIENT_TOKEN") };
}

export function loadHttpConfig(): HttpConfig {
  const host = process.env.ATHERLOOM_ESCAPE_MCP_HOST?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && process.env.ATHERLOOM_ESCAPE_MCP_ALLOW_REMOTE_HTTP !== "1") {
    throw new Error("MCP HTTP 默认只允许监听回环地址；公网请使用 HTTPS 反向代理");
  }
  const port = Number(process.env.ATHERLOOM_ESCAPE_MCP_PORT || 8795);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ATHERLOOM_ESCAPE_MCP_PORT 无效");
  return {
    host,
    port,
    accessToken: required("ATHERLOOM_ESCAPE_MCP_ACCESS_TOKEN"),
    allowedHosts: csv("ATHERLOOM_ESCAPE_MCP_ALLOWED_HOSTS", [`${host}:${port}`, host]),
    allowedOrigins: csv("ATHERLOOM_ESCAPE_MCP_ALLOWED_ORIGINS", [])
  };
}
