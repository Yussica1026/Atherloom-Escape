import { createServer, type Server } from "node:http";

const TOKEN = "arl_escape_test_client_token_abcdefghijklmnopqrstuvwxyz";

function reply(res: import("node:http").ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
}

export async function startMockRelay(): Promise<{ url: string; token: string; close(): Promise<void> }> {
  let version = 1;
  let cursor = 1;
  let ready = false;
  const events: Record<string, unknown>[] = [{ seq: 1, type: "game.created" }];
  const server: Server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(res, 401, { error: "unauthorized" });
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/v1/escape/games" && req.method === "POST") {
      return reply(res, 201, { game_id: "escape_mock", seat_id: "seat_self", invite_code: "ABCD-2345", theme: { world: "现代", tone: "正剧" }, mode: "ai_solo", version });
    }
    if (url.pathname === "/v1/escape/join" && req.method === "POST") {
      const body = await readBody(req);
      if (body.invite_code !== "ABCD-2345") return reply(res, 404, { error: "invite_not_found", message: "邀请码无效" });
      return reply(res, 200, { game_id: "escape_mock", seat_id: "seat_self", theme: { world: "现代", tone: "正剧" }, mode: "ai_solo", version });
    }
    if (url.pathname === "/v1/escape/games/escape_mock/state" && req.method === "GET") {
      const after = Number(url.searchParams.get("after") || 0);
      return reply(res, 200, { id: "escape_mock", selfSeatId: "seat_self", status: "active", version, eventCursor: cursor, actionRequired: "act", currentSeatId: "seat_self", clues: [], events: events.filter(event => Number(event.seq) > after) });
    }
    if (url.pathname === "/v1/escape/games/escape_mock/ready" && req.method === "POST") {
      ready = true; version += 1; cursor += 1; events.push({ seq: cursor, type: "seat.ready", data: { ready } });
      return reply(res, 200, { id: "escape_mock", version, eventCursor: cursor, actionRequired: "wait_or_start", events });
    }
    if (url.pathname === "/v1/escape/games/escape_mock/events" && req.method === "POST") {
      const body = await readBody(req); version += 2; cursor += 2;
      events.push({ seq: cursor - 1, type: body.type, data: body.data }, { seq: cursor, type: "turn.assigned", data: { seatId: "seat_self" } });
      return reply(res, 200, { id: "escape_mock", version, eventCursor: cursor, actionRequired: "act", events });
    }
    return reply(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock relay listen failed");
  return { url: `http://127.0.0.1:${address.port}`, token: TOKEN, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
