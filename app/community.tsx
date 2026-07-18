"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";
export const openCommunityAuthEvent = "fc-support:open-community-auth";

type CommunityUser = { id: number; loginId: string; nickname: string; createdAt: string };
type CommunityComment = { id: number; content: string; createdAt: string; author: { id: number; nickname: string }; canDelete: boolean };
type CommunityPost = {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  viewCount: number;
  commentCount: number;
  createdAt: string;
  author: { id: number; nickname: string };
  canDelete: boolean;
  comments?: CommunityComment[];
};
type PostList = { total: number; items: CommunityPost[]; offset: number; limit: number; hasMore: boolean };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "요청을 처리하지 못했습니다.");
  return payload as T;
}

function communityDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function CommunitySection() {
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [posts, setPosts] = useState<PostList>({ total: 0, items: [], offset: 0, limit: 10, hasMore: false });
  const [selected, setSelected] = useState<CommunityPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [composerOpen, setComposerOpen] = useState(false);

  const loadPosts = useCallback(async (offset = 0) => {
    setLoading(true);
    setError("");
    try {
      const result = await request<PostList>(`/api/community/posts?offset=${offset}&limit=10`);
      setPosts(result);
      if (selected) {
        const current = result.items.find((post) => post.id === selected.id);
        if (!current) setSelected(null);
      }
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    void request<{ user: CommunityUser | null }>("/api/auth/me")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null));
    void loadPosts(0);
  }, []);

  useEffect(() => {
    const open = () => { setAuthMode("login"); setAuthOpen(true); };
    window.addEventListener(openCommunityAuthEvent, open);
    return () => window.removeEventListener(openCommunityAuthEvent, open);
  }, []);

  async function openPost(postId: number) {
    setError("");
    try {
      const post = await request<CommunityPost>(`/api/community/posts/${postId}`);
      setSelected(post);
      setPosts((current) => ({ ...current, items: current.items.map((item) => item.id === postId ? { ...item, viewCount: post.viewCount } : item) }));
    } catch (requestError) {
      setError(String((requestError as Error).message));
    }
  }

  function updateSelectedPost(post: CommunityPost) {
    setSelected(post);
    setPosts((current) => ({
      ...current,
      items: current.items.map((item) => item.id === post.id ? {
        ...item,
        viewCount: post.viewCount,
        commentCount: post.commentCount,
        canDelete: post.canDelete,
      } : item),
    }));
  }

  async function logout() {
    await request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
    setComposerOpen(false);
    setSelected((current) => current ? { ...current, canDelete: false, comments: current.comments?.map((comment) => ({ ...comment, canDelete: false })) } : null);
    await loadPosts(posts.offset);
  }

  function requireLogin() {
    setAuthMode("login");
    setAuthOpen(true);
  }

  return (
    <section className="community-section" id="community">
      <div className="community-heading">
        <div>
          <p className="section-kicker">FC-SUPPORT COMMUNITY</p>
          <h2>감독모드 이야기를<br />함께 나누세요.</h2>
          <p>게시글과 댓글은 누구나 읽을 수 있으며, 작성은 로그인 후 가능합니다.</p>
        </div>
        <div className="community-account">
          {user ? <><span><small>로그인 중</small><b>{user.nickname}</b></span><button type="button" onClick={() => void logout()}>로그아웃</button></> : <button type="button" onClick={requireLogin}>로그인 · 회원가입</button>}
        </div>
      </div>

      <div className="community-board">
        <div className="community-list-panel">
          <div className="community-list-heading">
            <div><span>BOARD</span><h3>자유게시판</h3><p>총 {posts.total.toLocaleString()}개</p></div>
            <button className="community-primary-button" type="button" onClick={() => user ? setComposerOpen((value) => !value) : requireLogin()}>{composerOpen ? "작성 취소" : "글쓰기"}</button>
          </div>

          {composerOpen && user && <PostComposer onCreated={async (post) => { setComposerOpen(false); await loadPosts(0); await openPost(post.id); }} />}

          <div className="community-post-list" aria-live="polite">
            {loading ? <div className="community-empty"><b>게시글을 불러오는 중입니다.</b></div> : error && posts.items.length === 0 ? <div className="community-empty error"><b>{error}</b></div> : posts.items.length === 0 ? (
              <div className="community-empty"><span>NO POSTS</span><b>아직 작성된 게시글이 없습니다.</b><p>로그인 후 첫 이야기를 남겨보세요.</p></div>
            ) : posts.items.map((post) => (
              <button className={`community-post-row ${selected?.id === post.id ? "selected" : ""}`} type="button" key={post.id} onClick={() => void openPost(post.id)}>
                <span className="community-post-id">{String(post.id).padStart(3, "0")}</span>
                <span className="community-post-main"><b>{post.title}</b><small>{post.excerpt}</small></span>
                <span className="community-post-meta"><b>{post.author.nickname}</b><small>{communityDate(post.createdAt)} · 조회 {post.viewCount.toLocaleString()} · 댓글 {post.commentCount.toLocaleString()}</small></span>
              </button>
            ))}
          </div>

          {posts.total > posts.limit && <div className="community-pagination">
            <button type="button" disabled={posts.offset === 0 || loading} onClick={() => void loadPosts(Math.max(0, posts.offset - posts.limit))}>이전</button>
            <span>{Math.floor(posts.offset / posts.limit) + 1} / {Math.ceil(posts.total / posts.limit)}</span>
            <button type="button" disabled={!posts.hasMore || loading} onClick={() => void loadPosts(posts.offset + posts.limit)}>다음</button>
          </div>}
        </div>

        <div className="community-detail-panel">
          {selected ? <PostDetail post={selected} user={user} onLogin={requireLogin} onChanged={async () => { await loadPosts(posts.offset); setSelected(null); }} onPostChanged={updateSelectedPost} /> : (
            <div className="community-detail-empty"><span>COMMUNITY</span><h3>게시글을 선택해 주세요.</h3><p>게시글과 댓글은 로그인하지 않아도 확인할 수 있습니다.</p></div>
          )}
        </div>
      </div>

      {authOpen && <AuthDialog mode={authMode} onMode={setAuthMode} onClose={() => setAuthOpen(false)} onAuthenticated={async (nextUser) => { setUser(nextUser); setAuthOpen(false); await loadPosts(posts.offset); }} />}
    </section>
  );
}

function PostComposer({ onCreated }: { onCreated: (post: CommunityPost) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const post = await request<CommunityPost>("/api/community/posts", { method: "POST", body: JSON.stringify({ title, content }) });
      await onCreated(post);
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return <form className="community-composer" onSubmit={submit}>
    <label>제목<input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="제목을 입력해 주세요." /></label>
    <label>내용<textarea maxLength={5000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="감독모드 이야기를 작성해 주세요." /></label>
    {error && <p className="community-form-error">{error}</p>}
    <div><small>{content.length.toLocaleString()} / 5,000</small><button className="community-primary-button" disabled={saving} type="submit">{saving ? "등록 중" : "게시글 등록"}</button></div>
  </form>;
}

function PostDetail({ post, user, onLogin, onChanged, onPostChanged }: { post: CommunityPost; user: CommunityUser | null; onLogin: () => void; onChanged: () => Promise<void>; onPostChanged: (post: CommunityPost) => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function removePost() {
    if (!window.confirm("이 게시글을 삭제하시겠습니까?")) return;
    await request<{ ok: true }>(`/api/community/posts/${post.id}`, { method: "DELETE" });
    await onChanged();
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return onLogin();
    setSaving(true);
    setError("");
    try {
      await request<CommunityComment>(`/api/community/posts/${post.id}/comments`, { method: "POST", body: JSON.stringify({ content: comment }) });
      setComment("");
      onPostChanged(await request<CommunityPost>(`/api/community/posts/${post.id}`));
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  async function removeComment(commentId: number) {
    if (!window.confirm("이 댓글을 삭제하시겠습니까?")) return;
    await request<{ ok: true }>(`/api/community/comments/${commentId}`, { method: "DELETE" });
    onPostChanged(await request<CommunityPost>(`/api/community/posts/${post.id}`));
  }

  return <article className="community-detail">
    <header><div><span>POST {String(post.id).padStart(3, "0")}</span><h3>{post.title}</h3><p>{post.author.nickname} · {communityDate(post.createdAt)} · 조회 {post.viewCount.toLocaleString()}</p></div>{post.canDelete && <button type="button" onClick={() => void removePost()}>게시글 삭제</button>}</header>
    <div className="community-post-content">{post.content}</div>
    <section className="community-comments">
      <div className="community-comments-heading"><h4>댓글</h4><span>{(post.comments?.length || 0).toLocaleString()}개</span></div>
      <div className="community-comment-list">
        {post.comments?.length ? post.comments.map((item) => <article key={item.id}><div><b>{item.author.nickname}</b><small>{communityDate(item.createdAt)}</small></div><p>{item.content}</p>{item.canDelete && <button type="button" onClick={() => void removeComment(item.id)}>삭제</button>}</article>) : <p className="community-no-comments">아직 댓글이 없습니다.</p>}
      </div>
      <form className="community-comment-form" onSubmit={submitComment}>
        <textarea maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={user ? "댓글을 입력해 주세요." : "로그인 후 댓글을 작성할 수 있습니다."} onFocus={() => { if (!user) onLogin(); }} />
        {error && <p className="community-form-error">{error}</p>}
        <button className="community-primary-button" type="submit" disabled={saving}>{saving ? "등록 중" : "댓글 등록"}</button>
      </form>
    </section>
  </article>;
}

function AuthDialog({ mode, onMode, onClose, onAuthenticated }: { mode: "login" | "register"; onMode: (mode: "login" | "register") => void; onClose: () => void; onAuthenticated: (user: CommunityUser) => Promise<void> }) {
  const [loginId, setLoginId] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request<{ user: CommunityUser }>(`/api/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body: JSON.stringify({ loginId, nickname, password }) });
      await onAuthenticated(result.user);
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return <div className="community-auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="community-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="community-auth-title">
      <button className="community-auth-close" type="button" aria-label="닫기" onClick={onClose}>×</button>
      <p className="section-kicker">FC-SUPPORT MEMBER</p>
      <h3 id="community-auth-title">{mode === "login" ? "로그인" : "회원가입"}</h3>
      <div className="community-auth-tabs"><button className={mode === "login" ? "active" : ""} type="button" onClick={() => { onMode("login"); setError(""); }}>로그인</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => { onMode("register"); setError(""); }}>회원가입</button></div>
      <form onSubmit={submit}>
        <label>아이디<input autoComplete="username" minLength={4} maxLength={20} value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="영문, 숫자, 밑줄 4~20자" /></label>
        {mode === "register" && <label>닉네임<input autoComplete="nickname" minLength={2} maxLength={16} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="한글, 영문, 숫자, 밑줄 2~16자" /></label>}
        <label>비밀번호<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={72} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" /></label>
        {error && <p className="community-form-error">{error}</p>}
        <button className="community-primary-button" disabled={saving} type="submit">{saving ? "처리 중" : mode === "login" ? "로그인" : "회원가입"}</button>
      </form>
    </div>
  </div>;
}
