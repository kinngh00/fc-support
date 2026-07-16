import http from "node:http";
import net from "node:net";
import { ensureRuntimeDirectories, readJson, routesPath } from "./shared.mjs";

ensureRuntimeDirectories();
let lastRoutes = readJson(routesPath, {});

function routes() {
  const next = readJson(routesPath, null);
  if (next?.frontend?.port && next?.backend?.port) lastRoutes = next;
  return lastRoutes;
}

function createProxy(port, routeName) {
  const server = http.createServer((request, response) => {
    const targetPort = routes()?.[routeName]?.port;
    if (!targetPort) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "1" });
      response.end("FC-SUPPORT 서버를 준비하고 있습니다.");
      return;
    }
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `127.0.0.1:${targetPort}`, "x-forwarded-host": request.headers.host || "" },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("새 서버 연결을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.");
    });
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {});
    const targetPort = routes()?.[routeName]?.port;
    if (!targetPort) return socket.destroy();
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(request.headers)) upstream.write(`${name}: ${value}\r\n`);
      upstream.write("\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => { if (!socket.destroyed) socket.destroy(); });
  });
  server.listen(port, "127.0.0.1");
}

createProxy(3000, "frontend");
createProxy(8787, "backend");
http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, routes: routes() }));
}).listen(8799, "127.0.0.1");

console.log("FC-SUPPORT 무중단 전환기가 3000/8787 포트에서 실행 중입니다.");
