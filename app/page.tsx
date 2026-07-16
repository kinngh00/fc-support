"use client";

import { FormEvent, useEffect, useState } from "react";

type PickItem = {
  spid: string;
  pid: string;
  seasonId: number;
  season: string | null;
  seasonImage: string | null;
  name: string | null;
  grade: number;
  position: string;
  count: number;
  pickRate: number;
};

type PickResponse = {
  snapshot: { id: number; data_time: string; completed_at: string };
  matchingManagers: number;
  positionTotal: number;
  totalItems: number;
  items: PickItem[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

type Query = { start: string; end: string; team: string; position: string };

type BackendLog = {
  id: number;
  createdAt: string;
  level: "정보" | "경고" | "오류" | "성공";
  component: string;
  message: string;
  details: Record<string, unknown> | null;
};

type RankingItem = {
  rank: number;
  nickname: string;
  nexonSn: string;
  level: number | null;
  clubValue: string | null;
  elo: number | null;
  winRate: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  primaryTeamColor: string | null;
  teamImage: string | null;
  teamColorCount: number | null;
  formation: string | null;
  lineupStatus: string;
};

type RankingResponse = {
  snapshot: { id: number; data_time: string };
  total: number;
  items: RankingItem[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

const positionPriority = [
  "ST", "LS", "RS", "LW", "LF", "CF", "RF", "RW",
  "CAM", "LAM", "RAM", "LM", "LCM", "CM", "RCM", "RM",
  "LDM", "CDM", "RDM", "LWB", "LB", "LCB", "CB", "RCB", "RB", "RWB", "SW", "GK",
];
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";

function seasonLabel(season: string | null) {
  return season?.split(" ")[0] || "시즌 정보 없음";
}

function snapshotLabel(value?: string) {
  if (!value) return "수집 데이터 없음";
  return value.replace("T", " ").replace("+09:00", " KST");
}

function logTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function clubValueLabel(value: string | null) {
  if (!value) return "정보 없음";
  const amount = BigInt(value);
  const gyeong = amount / 10_000_000_000_000_000n;
  const jo = (amount % 10_000_000_000_000_000n) / 1_000_000_000_000n;
  if (gyeong > 0n) return `${gyeong.toLocaleString()}경 ${jo.toLocaleString()}조`;
  return `${(amount / 1_000_000_000_000n).toLocaleString()}조`;
}

function paginationItems(current: number, total: number) {
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

export default function Home() {
  const [rankStart, setRankStart] = useState("10");
  const [rankEnd, setRankEnd] = useState("100");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("ST");
  const [query, setQuery] = useState<Query>({ start: "10", end: "100", team: "", position: "ST" });
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [teamColors, setTeamColors] = useState<Array<{ name: string; managers: number }>>([]);
  const [result, setResult] = useState<PickResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [logs, setLogs] = useState<BackendLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState("");
  const [collectionRunning, setCollectionRunning] = useState(false);
  const [rankingTeam, setRankingTeam] = useState("");
  const [rankingResult, setRankingResult] = useState<RankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [rankingError, setRankingError] = useState("");
  const [rankingPage, setRankingPage] = useState(1);
  const [rankingNickname, setRankingNickname] = useState("");
  const [rankingSearchActive, setRankingSearchActive] = useState(false);
  const [rankingSearchLabel, setRankingSearchLabel] = useState("");

  function scrollToRankingTop() {
    window.requestAnimationFrame(() => {
      document.getElementById("ranking")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function fetchRankings(nextTeam = "", page = 1, shouldScroll = false) {
    setRankingLoading(true);
    setRankingError("");
    setRankingSearchActive(false);
    setRankingSearchLabel("");
    const parameters = new URLSearchParams({
      rankStart: "1",
      rankEnd: "10000",
      offset: String((page - 1) * 20),
      limit: "20",
    });
    if (nextTeam) parameters.set("teamColor", nextTeam);
    try {
      const response = await fetch(`${apiBaseUrl}/api/rankings?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "랭킹을 불러오지 못했습니다.");
      setRankingResult(payload);
      setRankingPage(page);
      if (shouldScroll) scrollToRankingTop();
    } catch (requestError) {
      setRankingResult(null);
      setRankingError(requestError instanceof Error ? requestError.message : "랭킹을 불러오지 못했습니다.");
    } finally {
      setRankingLoading(false);
    }
  }

  async function searchRanking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = rankingNickname.trim();
    if (!nickname) {
      await fetchRankings(rankingTeam, 1, true);
      return;
    }
    setRankingLoading(true);
    setRankingError("");
    try {
      const parameters = new URLSearchParams({ nickname });
      const response = await fetch(`${apiBaseUrl}/api/rankings/search?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "구단주 검색에 실패했습니다.");
      setRankingResult(payload);
      setRankingPage(1);
      setRankingSearchActive(true);
      setRankingSearchLabel(nickname);
      scrollToRankingTop();
    } catch (requestError) {
      setRankingResult(null);
      setRankingError(requestError instanceof Error ? requestError.message : "구단주 검색에 실패했습니다.");
    } finally {
      setRankingLoading(false);
    }
  }

  async function fetchPicks(nextQuery: Query, offset = 0, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    if (!append) {
      setError("");
      setResult(null);
    }
    const parameters = new URLSearchParams({
      rankStart: nextQuery.start,
      rankEnd: nextQuery.end,
      position: nextQuery.position,
      offset: String(offset),
      limit: "3",
    });
    if (nextQuery.team) parameters.set("teamColor", nextQuery.team);

    try {
      const response = await fetch(`${apiBaseUrl}/api/pick-rates?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "데이터를 불러오지 못했습니다.");
      setResult((current) =>
        append && current
          ? { ...payload, items: [...current.items, ...payload.items] }
          : payload,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function fetchAvailablePositions(nextQuery: Omit<Query, "position">) {
    const parameters = new URLSearchParams({
      rankStart: nextQuery.start,
      rankEnd: nextQuery.end,
    });
    if (nextQuery.team) parameters.set("teamColor", nextQuery.team);
    try {
      const response = await fetch(`${apiBaseUrl}/api/positions?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "포지션 정보를 불러오지 못했습니다.");
      const names = new Set<string>(
        Array.isArray(payload.items) ? payload.items.map((item: { name: string }) => item.name) : [],
      );
      const ordered = positionPriority.filter((item) => names.has(item));
      setAvailablePositions(ordered);
      return ordered;
    } catch {
      setAvailablePositions([]);
      return [];
    }
  }

  useEffect(() => {
    // Initial ranking synchronization intentionally begins after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRankings();
    void fetch(`${apiBaseUrl}/api/team-colors`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setTeamColors(Array.isArray(payload.items) ? payload.items : []))
      .catch(() => setTeamColors([]));
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLogs() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/logs?limit=200`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "로그를 불러오지 못했습니다.");
        if (!active) return;
        setLogs(Array.isArray(payload.items) ? payload.items : []);
        setCollectionRunning(Boolean(payload.collectionRunning));
        setLogsError("");
      } catch (requestError) {
        if (active) setLogsError(requestError instanceof Error ? requestError.message : "로그를 불러오지 못했습니다.");
      } finally {
        if (active) setLogsLoading(false);
      }
    }
    void loadLogs();
    const timer = window.setInterval(loadLogs, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function applyFilters() {
    setHasSearched(true);
    setLoading(true);
    setResult(null);
    setError("");
    const baseQuery = { start: rankStart, end: rankEnd, team };
    const available = await fetchAvailablePositions(baseQuery);
    const nextPosition = available.includes(position) ? position : (available[0] || position);
    setPosition(nextPosition);
    const nextQuery = { ...baseQuery, position: nextPosition };
    setQuery(nextQuery);
    await fetchPicks(nextQuery);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void applyFilters();
  }

  function selectPosition(nextPosition: string) {
    setPosition(nextPosition);
    const nextQuery = { start: rankStart, end: rankEnd, team, position: nextPosition };
    setQuery(nextQuery);
    void fetchPicks(nextQuery);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="FC-SUPPORT 홈">
          <span className="brand-mark">FC</span><span>SUPPORT</span>
        </a>
        <nav aria-label="주요 메뉴">
          <a className="active" href="#analysis">픽률 분석</a>
          <a href="#backend-logs">백엔드 로그</a>
          <a href="#ranking">랭커</a>
          <a href="#community">커뮤니티</a>
        </nav>
        <button className="login-button" type="button">로그인</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> MANAGER MODE INTELLIGENCE</p>
          <h1>감독모드,<br /><em>감이 아니라 데이터로.</em></h1>
          <p className="hero-description">
            상위 10,000명의 실제 선발 스쿼드를 분석해<br className="desktop-break" /> 포지션별 선수 픽률을 가장 빠르게 확인하세요.
          </p>
        </div>
        <div className="hero-index" aria-hidden="true">
          <span>01</span><div className="pitch-lines"><i /><i /><i /></div>
          <strong>10K</strong><small>RANKERS<br />HOURLY</small>
        </div>
      </section>

      <section className="analysis-shell" id="analysis">
        <div className="section-heading">
          <div><p className="section-kicker">PLAYER PICK RATE</p><h2>선수 픽률 조회</h2></div>
          <div className={`data-status ${error ? "status-error" : ""}`}>
            <span className="status-dot" /> {!hasSearched ? "조회 전" : loading ? "데이터 확인 중" : snapshotLabel(result?.snapshot.data_time)}
          </div>
        </div>

        <form className="filter-panel" onSubmit={submit}>
          <fieldset className="rank-fieldset">
            <legend>랭킹 범위</legend>
            <label><span>시작 순위</span><input aria-label="시작 순위" inputMode="numeric" min="1" max="10000" type="number" value={rankStart} onChange={(event) => setRankStart(event.target.value)} /><b>위</b></label>
            <i>—</i>
            <label><span>끝 순위</span><input aria-label="끝 순위" inputMode="numeric" min="1" max="10000" type="number" value={rankEnd} onChange={(event) => setRankEnd(event.target.value)} /><b>위</b></label>
          </fieldset>

          <label className="select-field">
            <span>팀컬러</span>
            <select value={team} onChange={(event) => setTeam(event.target.value)}>
              <option value="">전체 팀</option>
              {teamColors.map((color) => <option value={color.name} key={color.name}>{color.name}</option>)}
            </select>
          </label>

          <button className="search-button" type="submit" disabled={loading}>
            <span>{loading ? "조회 중" : "픽률 조회"}</span><b aria-hidden="true">↗</b>
          </button>
        </form>

        {hasSearched && <div className="results-layout">
          <aside className="position-panel">
            <p>POSITION</p>
            <div className="position-grid">
              {availablePositions.length > 0 ? availablePositions.map((item) => (
                <button className={position === item ? "selected" : ""} key={item} onClick={() => selectPosition(item)} type="button">{item}</button>
              )) : <p className="position-empty">사용 데이터가 있는 포지션이 없습니다.</p>}
            </div>
            <div className="position-note"><span>선발 기준</span>교체 선수와 상대 선수는 집계에서 제외됩니다.</div>
          </aside>

          <div className="result-content">
            <div className="result-topline">
              <div><p>{query.start}–{query.end}위 · {query.team || "전체 팀"}</p><h3>{query.position} 픽률</h3></div>
              {result && (
                <div className="result-stats">
                  <span><b>{result.matchingManagers.toLocaleString()}</b> 감독</span>
                  <span><b>{result.positionTotal.toLocaleString()}</b> {query.position} 기용</span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="empty-state"><span>LOADING</span><h4>수집된 데이터를 확인하고 있습니다.</h4></div>
            ) : error ? (
              <div className="empty-state"><span>NO DATA</span><h4>{error}</h4><p>데이터를 임의로 생성하지 않습니다.<br />수집이 완료되면 실제 결과만 표시됩니다.</p></div>
            ) : result && result.items.length > 0 ? (
              <>
                <div className="player-list">
                  {result.items.map((player, index) => (
                    <article className="player-row" key={`${player.spid}-${player.grade}`}>
                      <span className="list-rank">{String(index + 1).padStart(2, "0")}</span>
                      <div className="player-photo">
                        <img
                          alt={`${player.name || "선수"} 액션샷`}
                          src={`https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${player.spid}.png`}
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                            event.currentTarget.parentElement?.classList.add("missing");
                          }}
                        />
                      </div>
                      <div className="player-identity">
                        <div><span className={`season season-${seasonLabel(player.season).toLowerCase()}`}>{seasonLabel(player.season)}</span><b>+{player.grade}</b></div>
                        <h4>{player.name || "선수명 정보 없음"}</h4><small>SPID {player.spid}</small>
                      </div>
                      <div className="pick-meter">
                        <div><span>사용 {player.count.toLocaleString()}명</span><b>{player.pickRate.toFixed(2)}%</b></div>
                        <div className="meter-track"><i style={{ width: `${player.pickRate}%` }} /></div>
                      </div>
                    </article>
                  ))}
                </div>
                {result.hasMore && (
                  <button className="more-button" type="button" disabled={loadingMore} onClick={() => void fetchPicks(query, result.items.length, true)}>
                    {loadingMore ? "불러오는 중" : "3명 더 보기"}<span>＋</span>
                  </button>
                )}
              </>
            ) : (
              <div className="empty-state"><span>NO RESULT</span><h4>조건에 맞는 선발 데이터가 없습니다.</h4><p>조회 범위 또는 팀컬러와 포지션을 변경해 보세요.</p></div>
            )}
          </div>
        </div>}
      </section>

      <section className="log-section" id="backend-logs">
        <div className="log-heading">
          <div>
            <p className="section-kicker">TEMPORARY BACKEND MONITOR</p>
            <h2>백엔드 로그</h2>
          </div>
          <div className={`collector-state ${collectionRunning ? "running" : ""}`}>
            <span /> {collectionRunning ? "집계 진행 중" : "대기 중"}
          </div>
        </div>

        <div className="log-console">
          <div className="log-console-bar">
            <span>FC-SUPPORT / BACKEND</span>
            <small>3초마다 자동 갱신 · 최근 200건</small>
          </div>
          <div className="log-list" aria-live="polite">
            {logsLoading ? (
              <div className="log-empty">실제 백엔드 로그를 불러오는 중입니다.</div>
            ) : logsError ? (
              <div className="log-empty error">{logsError}</div>
            ) : logs.length === 0 ? (
              <div className="log-empty">기록된 백엔드 로그가 없습니다.</div>
            ) : logs.map((log) => (
              <article className={`log-row level-${log.level}`} key={log.id}>
                <time>{logTime(log.createdAt)}</time>
                <span className="log-level">{log.level}</span>
                <strong>{log.component}</strong>
                <div>
                  <p>{log.message}</p>
                  {log.details && <code>{JSON.stringify(log.details)}</code>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="ranking-section" id="ranking">
        <div className="ranking-heading">
          <div>
            <p className="section-kicker">MANAGER MODE RANKING</p>
            <h2>감독모드 랭킹</h2>
            <p className="ranking-description">활성 스냅샷의 1위부터 10,000위까지 실제 랭킹입니다.</p>
          </div>
          <div className="ranking-controls">
            <form className="ranking-search" onSubmit={searchRanking}>
              <label htmlFor="ranking-nickname">구단주 닉네임 검색</label>
              <div><input id="ranking-nickname" value={rankingNickname} onChange={(event) => setRankingNickname(event.target.value)} placeholder="닉네임 입력" /><button type="submit">검색</button></div>
            </form>
            <label className="ranking-filter">
              <span>팀컬러 필터</span>
              <select
                value={rankingTeam}
                onChange={(event) => {
                  const nextTeam = event.target.value;
                  setRankingTeam(nextTeam);
                  setRankingNickname("");
                  void fetchRankings(nextTeam, 1);
                }}
              >
                <option value="">전체 팀</option>
                {teamColors.map((color) => <option value={color.name} key={color.name}>{color.name} · {color.managers.toLocaleString()}명</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="ranking-board">
          <div className="ranking-board-meta">
            <span>{rankingSearchActive ? `NICKNAME · ${rankingSearchLabel}` : rankingTeam || "ALL TEAM COLORS"}</span>
            <p>{rankingResult ? `${rankingResult.total.toLocaleString()}명` : "데이터 없음"} · {snapshotLabel(rankingResult?.snapshot.data_time)}</p>
          </div>
          <div className="ranking-table-head" aria-hidden="true">
            <span>순위</span><span>구단주</span><span>팀컬러</span><span>포메이션</span><span>ELO</span><span>승률</span><span>구단가치</span>
          </div>

          {rankingLoading ? (
            <div className="ranking-empty">실제 랭킹을 불러오는 중입니다.</div>
          ) : rankingError ? (
            <div className="ranking-empty error">{rankingError}</div>
          ) : rankingResult && rankingResult.items.length > 0 ? (
            <div className="ranking-list">
              {rankingResult.items.map((ranker) => (
                <article className={`ranking-row ${ranker.rank <= 3 ? "podium" : ""}`} key={`${ranker.rank}-${ranker.nexonSn}`}>
                  <strong className="ranking-number">{String(ranker.rank).padStart(2, "0")}</strong>
                  <div className="ranking-coach">
                    <h3>{ranker.nickname}</h3>
                    <span>LV. {ranker.level?.toLocaleString() ?? "정보 없음"}</span>
                  </div>
                  <div className="ranking-team">
                    {ranker.teamImage ? <img src={ranker.teamImage} alt="" /> : <span className="team-image-missing" aria-label="팀 마크 없음" />}
                    <div><b>{ranker.primaryTeamColor || "팀컬러 없음"}</b><small>{ranker.teamColorCount ? `${ranker.teamColorCount}명 적용` : "적용 인원 없음"}</small></div>
                  </div>
                  <span className="ranking-formation">{ranker.formation || "—"}</span>
                  <strong className="ranking-elo">{ranker.elo?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? "—"}</strong>
                  <div className="ranking-record"><b>{ranker.winRate == null ? "—" : `${ranker.winRate.toFixed(1)}%`}</b><small>{ranker.wins ?? 0}승 {ranker.draws ?? 0}무 {ranker.losses ?? 0}패</small></div>
                  <span className="ranking-value">{clubValueLabel(ranker.clubValue)}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="ranking-empty">조건에 맞는 실제 랭킹 데이터가 없습니다.</div>
          )}

          {!rankingSearchActive && rankingResult && rankingResult.total > 0 && (
            <nav className="ranking-pagination" aria-label="랭킹 페이지">
              <button type="button" disabled={rankingLoading || rankingPage === 1} onClick={() => void fetchRankings(rankingTeam, rankingPage - 1, true)}>이전</button>
              <div>
                {paginationItems(rankingPage, Math.ceil(rankingResult.total / 20)).map((item, index) =>
                  item === "ellipsis" ? <span key={`ellipsis-${index}`}>···</span> : (
                    <button
                      className={rankingPage === item ? "current" : ""}
                      type="button"
                      key={item}
                      disabled={rankingLoading}
                      aria-current={rankingPage === item ? "page" : undefined}
                      onClick={() => void fetchRankings(rankingTeam, item, true)}
                    >{item}</button>
                  ),
                )}
              </div>
              <button type="button" disabled={rankingLoading || rankingPage === Math.ceil(rankingResult.total / 20)} onClick={() => void fetchRankings(rankingTeam, rankingPage + 1, true)}>다음</button>
            </nav>
          )}
        </div>
      </section>

      <section className="community-section" id="community">
        <div><p className="section-kicker">FC-SUPPORT COMMUNITY</p><h2>데이터 다음은,<br />당신의 전술.</h2></div>
        <div className="community-copy"><p>픽률을 확인하고, 스쿼드를 공유하고,<br />감독모드 이야기를 이어가세요.</p><button type="button">커뮤니티 준비 중 <span>→</span></button></div>
      </section>

      <footer><a className="brand footer-brand" href="#top"><span className="brand-mark">FC</span><span>SUPPORT</span></a><p>Data based on NEXON Open API</p><small>FC-SUPPORT is not associated with or endorsed by NEXON Korea.</small></footer>
    </main>
  );
}
