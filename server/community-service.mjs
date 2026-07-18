import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, transaction } from "./database.mjs";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
export const sessionCookieName = "fc_support_session";

export class CommunityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requiredText(value, name, min, max) {
  if (typeof value !== "string") throw new CommunityError(400, "INVALID_INPUT", `${name}을(를) 입력해 주세요.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new CommunityError(400, "INVALID_INPUT", `${name}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return text;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function passwordHash(password, salt) {
  return Buffer.from(await scrypt(password, salt, 64)).toString("hex");
}

function publicUser(row) {
  if (!row) return null;
  return { id: Number(row.id), loginId: row.login_id, nickname: row.nickname, createdAt: row.created_at };
}

function postRow(row, viewerId = null) {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    excerpt: row.content.length > 140 ? `${row.content.slice(0, 140)}…` : row.content,
    viewCount: Number(row.view_count),
    commentCount: Number(row.comment_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: Number(row.author_id), nickname: row.author_nickname },
    canDelete: viewerId != null && Number(row.author_id) === Number(viewerId),
  };
}

function commentRow(row, viewerId = null) {
  return {
    id: Number(row.id),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: Number(row.author_id), nickname: row.author_nickname },
    canDelete: viewerId != null && Number(row.author_id) === Number(viewerId),
  };
}

export function sessionCookie(token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  const value = token ? `${sessionCookieName}=${token}` : `${sessionCookieName}=`;
  return `${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function sessionTokenFromRequest(request) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === sessionCookieName) return cookie.slice(separator + 1).trim();
  }
  return "";
}

export function userFromSessionToken(token) {
  if (!token) return null;
  db.prepare("DELETE FROM community_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  const row = db.prepare(`
    SELECT u.id, u.login_id, u.nickname, u.created_at
    FROM community_sessions s
    JOIN community_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), new Date().toISOString());
  return publicUser(row);
}

export function requireUser(token) {
  const user = userFromSessionToken(token);
  if (!user) throw new CommunityError(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  return user;
}

function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO community_sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash(token), userId, createdAt.toISOString(), expiresAt.toISOString());
  return token;
}

export async function registerUser(input) {
  const loginId = requiredText(input?.loginId, "아이디", 4, 20);
  const nickname = requiredText(input?.nickname, "닉네임", 2, 16);
  const password = requiredText(input?.password, "비밀번호", 8, 72);
  if (!/^[a-zA-Z0-9_]+$/.test(loginId)) {
    throw new CommunityError(400, "INVALID_LOGIN_ID", "아이디는 영문, 숫자, 밑줄만 사용할 수 있습니다.");
  }
  if (!/^[가-힣a-zA-Z0-9_]+$/u.test(nickname)) {
    throw new CommunityError(400, "INVALID_NICKNAME", "닉네임은 한글, 영문, 숫자, 밑줄만 사용할 수 있습니다.");
  }
  if (db.prepare("SELECT 1 FROM community_users WHERE login_id = ? COLLATE NOCASE").get(loginId)) {
    throw new CommunityError(409, "LOGIN_ID_EXISTS", "이미 사용 중인 아이디입니다.");
  }
  if (db.prepare("SELECT 1 FROM community_users WHERE nickname = ? COLLATE NOCASE").get(nickname)) {
    throw new CommunityError(409, "NICKNAME_EXISTS", "이미 사용 중인 닉네임입니다.");
  }

  const salt = randomBytes(16).toString("hex");
  const hash = await passwordHash(password, salt);
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO community_users (login_id, nickname, password_hash, password_salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(loginId, nickname, hash, salt, now, now);
  const user = publicUser(db.prepare("SELECT id, login_id, nickname, created_at FROM community_users WHERE id = ?").get(result.lastInsertRowid));
  return { user, token: createSession(user.id) };
}

export async function loginUser(input) {
  const loginId = requiredText(input?.loginId, "아이디", 4, 20);
  const password = requiredText(input?.password, "비밀번호", 8, 72);
  const row = db.prepare("SELECT * FROM community_users WHERE login_id = ? COLLATE NOCASE").get(loginId);
  if (!row) throw new CommunityError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
  const actual = Buffer.from(await passwordHash(password, row.password_salt), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new CommunityError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  return { user: publicUser(row), token: createSession(Number(row.id)) };
}

export function logoutUser(token) {
  if (token) db.prepare("DELETE FROM community_sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function listPosts({ offset = 0, limit = 20, viewerId = null } = {}) {
  const total = Number(db.prepare("SELECT COUNT(*) AS count FROM community_posts").get().count);
  const rows = db.prepare(`
    SELECT p.*, u.nickname AS author_nickname, COUNT(c.id) AS comment_count
    FROM community_posts p
    JOIN community_users u ON u.id = p.author_id
    LEFT JOIN community_comments c ON c.post_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  return { total, items: rows.map((row) => postRow(row, viewerId)), offset, limit, hasMore: offset + rows.length < total };
}

export function getPost(postId, { viewerId = null, incrementView = true } = {}) {
  if (incrementView) db.prepare("UPDATE community_posts SET view_count = view_count + 1 WHERE id = ?").run(postId);
  const row = db.prepare(`
    SELECT p.*, u.nickname AS author_nickname, COUNT(c.id) AS comment_count
    FROM community_posts p
    JOIN community_users u ON u.id = p.author_id
    LEFT JOIN community_comments c ON c.post_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(postId);
  if (!row) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  const comments = db.prepare(`
    SELECT c.*, u.nickname AS author_nickname
    FROM community_comments c
    JOIN community_users u ON u.id = c.author_id
    WHERE c.post_id = ?
    ORDER BY c.created_at, c.id
  `).all(postId).map((comment) => commentRow(comment, viewerId));
  return { ...postRow(row, viewerId), comments };
}

export function createPost(userId, input) {
  const title = requiredText(input?.title, "제목", 2, 80);
  const content = requiredText(input?.content, "내용", 2, 5000);
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO community_posts (author_id, title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, title, content, now, now);
  return getPost(Number(result.lastInsertRowid), { viewerId: userId, incrementView: false });
}

export function deletePost(userId, postId) {
  const row = db.prepare("SELECT author_id FROM community_posts WHERE id = ?").get(postId);
  if (!row) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  if (Number(row.author_id) !== Number(userId)) throw new CommunityError(403, "FORBIDDEN", "본인이 작성한 게시글만 삭제할 수 있습니다.");
  db.prepare("DELETE FROM community_posts WHERE id = ?").run(postId);
}

export function createComment(userId, postId, input) {
  const content = requiredText(input?.content, "댓글", 1, 1000);
  if (!db.prepare("SELECT 1 FROM community_posts WHERE id = ?").get(postId)) {
    throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  }
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO community_comments (post_id, author_id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(postId, userId, content, now, now);
  const row = db.prepare(`
    SELECT c.*, u.nickname AS author_nickname
    FROM community_comments c JOIN community_users u ON u.id = c.author_id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);
  return commentRow(row, userId);
}

export function deleteComment(userId, commentId) {
  const row = db.prepare("SELECT author_id FROM community_comments WHERE id = ?").get(commentId);
  if (!row) throw new CommunityError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  if (Number(row.author_id) !== Number(userId)) throw new CommunityError(403, "FORBIDDEN", "본인이 작성한 댓글만 삭제할 수 있습니다.");
  db.prepare("DELETE FROM community_comments WHERE id = ?").run(commentId);
}
