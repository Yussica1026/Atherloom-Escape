import { cp, mkdir, rm } from "node:fs/promises";

await rm("site", { recursive: true, force: true });
await mkdir("site/web", { recursive: true });
await mkdir("site/shared", { recursive: true });
await cp("index.html", "site/index.html");
await cp("manifest.webmanifest", "site/manifest.webmanifest");
await cp("sw.js", "site/sw.js");
await cp("LICENSE", "site/LICENSE.txt");
await cp("web", "site/web", { recursive: true });
await cp("shared/escape-core.mjs", "site/shared/escape-core.mjs");
await cp("shared/referee-prompt.mjs", "site/shared/referee-prompt.mjs");
