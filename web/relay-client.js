const DEFAULT_RELAY_URL = "https://escape.top2.online";

export class RelayError extends Error {
  constructor(code, message, status = 0) {
    super(message || code || "relay_error");
    this.name = "RelayError";
    this.code = code || "relay_error";
    this.status = status;
  }
}

function cleanBaseUrl(value) {
  return String(value || DEFAULT_RELAY_URL).trim().replace(/\/+$/, "");
}

export class EscapeRelayClient {
  constructor({ baseUrl = DEFAULT_RELAY_URL, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.fetchImpl = (...args) => fetchImpl(...args);
  }

  async request(path, { method = "GET", token = "", body, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new RelayError("network_error", "无法连接联机服务，请检查网络后重试");
    }
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new RelayError(payload.error, payload.message || `联机服务返回 ${response.status}`, response.status);
    return payload;
  }

  health(options = {}) {
    return this.request("/health", options);
  }

  createGame(input, options = {}) {
    return this.request("/v1/escape/games", { ...options, method: "POST", body: input });
  }

  joinGame(input, options = {}) {
    return this.request("/v1/escape/join", { ...options, method: "POST", body: input });
  }

  getState(gameId, token, options = {}) {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/state`, { ...options, token });
  }

  setReady(gameId, token, expectedVersion, ready = true, options = {}) {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/ready`, {
      ...options,
      method: "POST",
      token,
      body: { expected_version: expectedVersion, ready }
    });
  }

  startGame(gameId, token, expectedVersion, options = {}) {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/start`, {
      ...options,
      method: "POST",
      token,
      body: { expected_version: expectedVersion }
    });
  }

  sendEvent(gameId, token, expectedVersion, type, data, requestId = crypto.randomUUID(), options = {}) {
    return this.request(`/v1/escape/games/${encodeURIComponent(gameId)}/events`, {
      ...options,
      method: "POST",
      token,
      body: { expected_version: expectedVersion, type, data, request_id: requestId }
    });
  }
}

export const RELAY_URL = DEFAULT_RELAY_URL;
