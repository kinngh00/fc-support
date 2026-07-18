import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`backend exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend did not start in time");
}

async function call(baseUrl, pathname, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] || "" };
}

test("community auth, public reads, member writes and owner deletes", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "fc-support-community-"));
  const port = 19000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      FC_BACKEND_PORT: String(port),
      FC_DB_PATH: path.join(directory, "community.db"),
      FC_SCHEDULER_ENABLED: "false",
      FC_COLLECT_ON_EMPTY: "false",
      FC_COLLECT_ON_STALE: "false",
      FC_RECOVER_ABANDONED_SNAPSHOTS: "false",
      FC_FRONTEND_ORIGIN: "http://localhost:3000",
    },
    stdio: "ignore",
  });
  context.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode == null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child);

  const empty = await call(baseUrl, "/api/community/posts");
  assert.equal(empty.response.status, 200);
  assert.equal(empty.payload.total, 0);
  assert.deepEqual(empty.payload.items, []);

  const anonymousCreate = await call(baseUrl, "/api/community/posts", { method: "POST", body: { title: "테스트", content: "내용입니다." } });
  assert.equal(anonymousCreate.response.status, 401);

  const registration = await call(baseUrl, "/api/auth/register", { method: "POST", body: { loginId: "owner_01", nickname: "작성자", password: "secure-pass-01" } });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.cookie.startsWith("fc_support_session="));

  const me = await call(baseUrl, "/api/auth/me", { cookie: registration.cookie });
  assert.equal(me.payload.user.nickname, "작성자");

  const creation = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: registration.cookie, body: { title: "실제 게시글", content: "DB에 저장되는 실제 내용입니다." } });
  assert.equal(creation.response.status, 201);
  assert.equal(creation.payload.canDelete, true);

  const publicList = await call(baseUrl, "/api/community/posts");
  assert.equal(publicList.payload.total, 1);
  assert.equal(publicList.payload.items[0].title, "실제 게시글");
  assert.equal(publicList.payload.items[0].canDelete, false);

  const publicDetail = await call(baseUrl, `/api/community/posts/${creation.payload.id}`);
  assert.equal(publicDetail.response.status, 200);
  assert.equal(publicDetail.payload.content, "DB에 저장되는 실제 내용입니다.");

  const comment = await call(baseUrl, `/api/community/posts/${creation.payload.id}/comments`, { method: "POST", cookie: registration.cookie, body: { content: "첫 댓글" } });
  assert.equal(comment.response.status, 201);
  assert.equal(comment.payload.canDelete, true);

  const secondRegistration = await call(baseUrl, "/api/auth/register", { method: "POST", body: { loginId: "reader_02", nickname: "다른회원", password: "secure-pass-02" } });
  assert.equal(secondRegistration.response.status, 201);
  const forbiddenPostDelete = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { method: "DELETE", cookie: secondRegistration.cookie });
  assert.equal(forbiddenPostDelete.response.status, 403);
  const forbiddenCommentDelete = await call(baseUrl, `/api/community/comments/${comment.payload.id}`, { method: "DELETE", cookie: secondRegistration.cookie });
  assert.equal(forbiddenCommentDelete.response.status, 403);

  const commentDelete = await call(baseUrl, `/api/community/comments/${comment.payload.id}`, { method: "DELETE", cookie: registration.cookie });
  assert.equal(commentDelete.response.status, 200);
  const postDelete = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { method: "DELETE", cookie: registration.cookie });
  assert.equal(postDelete.response.status, 200);

  const finalList = await call(baseUrl, "/api/community/posts");
  assert.equal(finalList.payload.total, 0);
});
