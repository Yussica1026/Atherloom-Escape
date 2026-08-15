import type { RelayConfig } from "./config.js";

export type RelayProblem = { code: string; status?: number; reason?: string; retry?: string };

export class RelayError extends Error {
  constructor(public readonly problem: RelayProblem) {
    super(problem.code);
  }
}

export class EscapeRelayClient {
  constructor(private readonly config: RelayConfig) {}

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.clientToken}`,
          "content-type": "application/json",
          ...(init.headers || {})
        },
        signal: AbortSignal.timeout(30_000)
      });
    } catch {
      throw new RelayError({ code: "relay_unreachable", retry: "确认 Relay 地址、HTTPS 与网络后重试" });
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new RelayError({
      code: String(body.error || "relay_error"),
      status: response.status,
      ...(typeof body.message === "string" ? { reason: body.message } : {})
    });
    return body;
  }

  create(gameType: string, mode: string, role: string, displayName: string, refereeName: string, refereeRoute: string): Promise<Record<string, unknown>> {
    return this.request("/v1/escape/games", { method: "POST", body: JSON.stringify({
      game_type: gameType,
      mode,
      kind: "ai",
      role,
      display_name: displayName,
      platform: "mcp",
      referee: { display_name: refereeName, route_label: refereeRoute, platform: "dedicated-referee" }
    }) });
  }

  join(inviteCode: string, displayName: string, role: string): Promise<Record<string, unknown>> {
    return this.request("/v1/escape/join", { method: "POST", body: JSON.stringify({ invite_code: inviteCode, kind: "ai", role, display_name: displayName, platform: "mcp" }) });
  }

  state(gameId: string, after = 0): Promise<Record<string, unknown>> {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/state?after=${after}`);
  }

  ready(gameId: string, expectedVersion: number, ready = true): Promise<Record<string, unknown>> {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/ready`, { method: "POST", body: JSON.stringify({ expected_version: expectedVersion, ready }) });
  }

  start(gameId: string, expectedVersion: number): Promise<Record<string, unknown>> {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/start`, { method: "POST", body: JSON.stringify({ expected_version: expectedVersion }) });
  }

  event(gameId: string, expectedVersion: number, type: string, data: Record<string, unknown>, requestId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/events`, { method: "POST", body: JSON.stringify({ expected_version: expectedVersion, type, data, request_id: requestId }) });
  }

  async wait(gameId: string, after: number, waitSeconds: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + Math.min(25, Math.max(0, waitSeconds)) * 1000;
    let latest = await this.state(gameId, after);
    while (Date.now() < deadline && Number(latest.eventCursor || 0) <= after && ["wait", "watch"].includes(String(latest.actionRequired))) {
      await new Promise(resolve => setTimeout(resolve, 800));
      latest = await this.state(gameId, after);
    }
    return latest;
  }
}
