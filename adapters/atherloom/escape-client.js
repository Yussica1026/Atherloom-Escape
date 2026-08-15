/**
 * Atherloom-side REST adapter. The caller owns secure token storage and model calls.
 * No API key, Relay token, persona prompt, or private memory is written here.
 */
export class AtherloomEscapeClient {
  constructor({ relayUrl, getToken, saveSeatToken }) {
    this.relayUrl = String(relayUrl).replace(/\/+$/, "");
    this.getToken = getToken;
    this.saveSeatToken = saveSeatToken;
  }

  async request(path, { method = "GET", body, token } = {}) {
    const identity = token || await this.getToken?.();
    const response = await fetch(`${this.relayUrl}${path}`, {
      method,
      headers: {
        ...(identity ? { authorization: `Bearer ${identity}` } : {}),
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || "密室 Relay 请求失败");
      error.code = result.error || "relay_error";
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async create({ gameType = "escape", mode, kind, role = "player", displayName, referee }) {
    const result = await this.request("/v1/escape/games", { method: "POST", body: {
      game_type: gameType,
      mode,
      kind,
      role,
      display_name: displayName,
      platform: "atherloom",
      referee: referee ? {
        display_name: referee.displayName,
        route_label: referee.routeLabel,
        platform: "atherloom-dedicated-referee"
      } : undefined
    } });
    if (result.seat_token) await this.saveSeatToken?.(result.game_id, result.seat_token);
    return result;
  }

  async join({ inviteCode, kind, role = "player", displayName }) {
    const result = await this.request("/v1/escape/join", { method: "POST", body: { invite_code: inviteCode, kind, role, display_name: displayName, platform: "atherloom" } });
    if (result.seat_token) await this.saveSeatToken?.(result.game_id, result.seat_token);
    return result;
  }

  state(gameId, token, after = 0) { return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/state?after=${after}`, { token }); }
  ready(gameId, token, version, ready = true) { return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/ready`, { method: "POST", token, body: { expected_version: version, ready } }); }
  start(gameId, token, version) { return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/start`, { method: "POST", token, body: { expected_version: version } }); }
  event(gameId, token, version, type, data) {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/events`, {
      method: "POST", token,
      body: { expected_version: version, type, data, request_id: crypto.randomUUID() }
    });
  }
}
