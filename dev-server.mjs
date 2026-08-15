import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("./", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const port = Number(process.env.PORT || 8794);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
  let target = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  if (!target.startsWith(normalize(root))) { response.writeHead(403); return response.end("Forbidden"); }
  try {
    if ((await stat(target)).isDirectory()) target = join(target, "index.html");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => process.stdout.write(`Atherloom Escape: http://127.0.0.1:${port}\n`));
