import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((item) => item.split("=")));
const port = Number(args.port || 3100);
const vinextPort = Number(args.vinextPort || port + 200);
const clientDir = path.resolve("dist/client");
const contentTypes = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

const vinext = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--port", String(vinextPort)], {
  cwd: process.cwd(), env: process.env, stdio: "inherit", windowsHide: true,
});

function staticFile(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const candidate = path.resolve(clientDir, `.${decoded}`);
  if (!candidate.startsWith(`${clientDir}${path.sep}`) || !existsSync(candidate)) return null;
  const stat = statSync(candidate);
  return stat.isFile() ? { path: candidate, size: stat.size } : null;
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const file = (request.method === "GET" || request.method === "HEAD") ? staticFile(pathname) : null;
  if (file) {
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(file.path).toLowerCase()] || "application/octet-stream",
      "content-length": file.size,
      "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file.path).pipe(response);
    return;
  }
  const upstream = http.request({
    hostname: "127.0.0.1", port: vinextPort, method: request.method, path: request.url, headers: request.headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("프론트엔드 서버를 준비하고 있습니다.");
  });
  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => console.log(`FC-SUPPORT frontend wrapper: ${port} -> ${vinextPort}`));
async function shutdown() {
  server.close();
  try { vinext.kill("SIGTERM"); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
vinext.on("exit", (code) => { if (code) process.exit(code); });
