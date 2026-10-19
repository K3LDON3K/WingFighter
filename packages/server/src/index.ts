import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "@spacegame/shared";
import { Hub } from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const here = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIST = resolve(here, "../../client/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const http = createServer((req, res) => {
  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("Klient není sestaven. Spusťte `npm run build` (nebo `npm start`).");
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = normalize(join(CLIENT_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(CLIENT_DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIST, "index.html");
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
});

const hub = new Hub();
const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (ws) => {
  let client = hub.connect(ws);
  let registered = false;
  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "hello") {
      client = hub.hello(client, msg);
      registered = true;
      return;
    }
    if (!registered) return;
    try {
      hub.handle(client, msg);
    } catch (e) {
      console.error("Chyba při zpracování zprávy", msg.type, e);
      hub.error(client, "Na serveru došlo k chybě.");
    }
  });
  ws.on("close", () => {
    if (registered) hub.disconnect(client);
  });
});

http.listen(PORT, HOST, () => {
  console.log("");
  console.log("  SpaceGame server běží.");
  console.log(`  Lokálně:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  V síti:    http://${ip}:${PORT}`);
  console.log("");
  console.log("  Hráči na stejné síti otevřou adresu „V síti“ v prohlížeči.");
  console.log("  Ukončení: Ctrl+C");
  console.log("");
});

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}
