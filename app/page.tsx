"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

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

type Query = { start: string; end: string; team: string; position: string; detailed: boolean };

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
  previousRank: number | null;
  previousClubValue: string | null;
  previousWinRate: number | null;
};

type RankingResponse = {
  snapshot: { id: number; data_time: string };
  total: number;
  items: RankingItem[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

type HistoryItem = { dataTime: string; rank: number; clubValue: string; winRate: number | null };
type HistoryFrame = "hour" | "day" | "week";
type HistoryChange = { label: string; trend: "up" | "down" | "same" };
type SquadItem = { slot: number; spid: string; grade: number; position: string | null; name: string | null; season: string | null; seasonImage: string | null };
type UserProfileResponse = {
  snapshot: { id: number; data_time: string };
  profile: RankingItem & { hasOuid: boolean };
  history: HistoryItem[];
  squad: SquadItem[];
};
type MatchParticipant = {
  nickname: string | null; result: string | null; score: number; possession: number;
  shots: number; effectiveShots: number; passTry: number; passSuccess: number;
  fouls: number; corners: number; yellowCards: number; redCards: number;
};
type MatchItem = {
  matchId: string; matchDate: string; self: MatchParticipant | null; opponent: MatchParticipant | null;
  players: { self: SquadItem[]; opponent: SquadItem[] };
};

const positionPriority = [
  "LW", "LS", "ST", "RS", "RW", "LF", "CF", "RF",
  "LAM", "CAM", "RAM", "LM", "LCM", "CM", "RCM", "RM",
  "LDM", "CDM", "RDM", "LWB", "LB", "LCB", "CB", "RCB", "RB", "RWB", "SW", "GK",
];
const attackingPositions = new Set(["ST", "LS", "RS", "LW", "LF", "CF", "RF", "RW"]);
const midfieldPositions = new Set(["CAM", "LAM", "RAM", "LM", "LCM", "CM", "RCM", "RM", "LDM", "CDM", "RDM"]);

function positionGroup(position: string | null) {
  if (position && attackingPositions.has(position)) return "attack";
  if (position && midfieldPositions.has(position)) return "midfield";
  return "defense";
}

function orderedSquad(items: SquadItem[]) {
  return [...items].sort((left, right) => {
    const leftIndex = positionPriority.indexOf(left.position || "");
    const rightIndex = positionPriority.indexOf(right.position || "");
    const normalizedLeft = leftIndex === -1 ? positionPriority.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? positionPriority.length : rightIndex;
    return normalizedLeft - normalizedRight || left.slot - right.slot;
  });
}
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";

function seasonLabel(season: string | null) {
  return season?.split(" ")[0] || "시즌 정보 없음";
}

function snapshotLabel(value?: string) {
  if (!value) return "수집 데이터 없음";
  return value.replace("T", " ").replace("+09:00", " KST");
}

function simpleSnapshotLabel(value?: string) {
  if (!value) return "시간 정보 없음";
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]} 기준` : "시간 정보 없음";
}

function integerLabel(value: string | number | null | undefined, minimumIntegerDigits = 1) {
  return Number(value || 0).toLocaleString("ko-KR", { minimumIntegerDigits });
}

function historyBucket(dataTime: string, frame: HistoryFrame) {
  const date = new Date(dataTime);
  if (frame === "hour") return dataTime.slice(0, 13);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  if (frame === "day") return kst.toISOString().slice(0, 10);
  const day = kst.getUTCDay() || 7;
  kst.setUTCDate(kst.getUTCDate() - day + 1);
  return kst.toISOString().slice(0, 10);
}

function aggregateHistory(items: HistoryItem[], frame: HistoryFrame) {
  if (frame === "hour") return items;
  const buckets = new Map<string, HistoryItem>();
  for (const item of items) buckets.set(historyBucket(item.dataTime, frame), item);
  return [...buckets.values()];
}

function historyTooltipLabel(value: string | undefined) {
  if (!value) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
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

function clubValueChangeLabel(amount: bigint) {
  const absolute = amount < 0n ? -amount : amount;
  const gyeong = absolute / 10_000_000_000_000_000n;
  const jo = (absolute % 10_000_000_000_000_000n) / 1_000_000_000_000n;
  const eok = (absolute % 1_000_000_000_000n) / 100_000_000n;
  if (gyeong > 0n) return `${gyeong.toLocaleString()}경 ${jo.toLocaleString()}조`;
  if (jo > 0n) return `${jo.toLocaleString()}조 ${eok.toLocaleString()}억`;
  if (eok > 0n) return `${eok.toLocaleString()}억`;
  return absolute.toLocaleString("ko-KR");
}

function historyClubValueLabel(value: number) {
  return clubValueLabel(String(BigInt(Math.round(value)) * 1_000_000_000_000n));
}

function RankingDelta({ direction, label, unavailable = false }: {
  direction: "up" | "down" | "same";
  label: string;
  unavailable?: boolean;
}) {
  return <small className={`ranking-delta trend-${unavailable ? "unavailable" : direction}`}>
    {unavailable ? "이전 기록 없음" : direction === "up" ? `▲ ${label}` : direction === "down" ? `▼ ${label}` : "변동 없음"}
  </small>;
}

function RankDelta({ current, previous }: { current: number; previous: number | null }) {
  if (previous == null) return <RankingDelta direction="same" label="" unavailable />;
  const difference = previous - current;
  return <RankingDelta direction={difference > 0 ? "up" : difference < 0 ? "down" : "same"} label={`${Math.abs(difference).toLocaleString()}위`} />;
}

function ClubValueDelta({ current, previous }: { current: string | null; previous: string | null }) {
  if (current == null || previous == null) return <RankingDelta direction="same" label="" unavailable />;
  const difference = BigInt(current) - BigInt(previous);
  return <RankingDelta direction={difference > 0n ? "up" : difference < 0n ? "down" : "same"} label={clubValueChangeLabel(difference)} />;
}

function WinRateDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return <RankingDelta direction="same" label="" unavailable />;
  const difference = current - previous;
  return <RankingDelta direction={difference > 0 ? "up" : difference < 0 ? "down" : "same"} label={`${Math.abs(difference).toFixed(1)}%p`} />;
}

function rankHistoryChange(first: HistoryItem, last: HistoryItem): HistoryChange {
  const difference = first.rank - last.rank;
  if (difference > 0) return { label: `${difference.toLocaleString()}등 상승`, trend: "up" };
  if (difference < 0) return { label: `${Math.abs(difference).toLocaleString()}등 하락`, trend: "down" };
  return { label: "순위 변동 없음", trend: "same" };
}

function clubValueHistoryChange(first: HistoryItem, last: HistoryItem): HistoryChange {
  const difference = BigInt(last.clubValue) - BigInt(first.clubValue);
  if (difference > 0n) return { label: `${clubValueChangeLabel(difference)} 상승`, trend: "up" };
  if (difference < 0n) return { label: `${clubValueChangeLabel(difference)} 하락`, trend: "down" };
  return { label: "구단가치 변동 없음", trend: "same" };
}

function winRateHistoryChange(first: HistoryItem, last: HistoryItem): HistoryChange {
  const difference = Number(((last.winRate ?? 0) - (first.winRate ?? 0)).toFixed(1));
  if (difference > 0) return { label: `${difference.toFixed(1)}%p 상승`, trend: "up" };
  if (difference < 0) return { label: `${Math.abs(difference).toFixed(1)}%p 하락`, trend: "down" };
  return { label: "승률 변동 없음", trend: "same" };
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

function TeamAutocomplete({ id, label, value, options, onChange, onSelect }: {
  id: string; label: string; value: string; options: string[]; onChange: (value: string) => void; onSelect?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = value.trim().toLocaleLowerCase("ko-KR");
  const matches = options
    .filter((option) => !normalized || option.toLocaleLowerCase("ko-KR").startsWith(normalized))
    .slice(0, 12);
  return (
    <div className="autocomplete-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} role="combobox" aria-controls={`${id}-options`} aria-expanded={open} autoComplete="off" value={value} placeholder="전체 팀" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} />
      {open && matches.length > 0 && <div className="autocomplete-menu" id={`${id}-options`} role="listbox">
        {!normalized && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); onSelect?.(""); setOpen(false); }}>전체 팀</button>}
        {matches.map((option) => <button type="button" role="option" aria-selected={value === option} key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); onSelect?.(option); setOpen(false); }}>{option}</button>)}
      </div>}
    </div>
  );
}

function NicknameAutocomplete({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ nickname: string; rank: number }>>([]);
  useEffect(() => {
    const prefix = value.trim();
    if (!open || !prefix) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ prefix });
      void fetch(`${apiBaseUrl}/api/users/suggestions?${parameters}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((payload) => setSuggestions(Array.isArray(payload.items) ? payload.items : []))
        .catch(() => setSuggestions([]));
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, value]);
  return (
    <div className="autocomplete-field nickname-autocomplete">
      <label htmlFor={id}>{label}</label>
      <input id={id} role="combobox" aria-controls={`${id}-options`} aria-expanded={open} autoComplete="off" value={value} placeholder="닉네임 입력" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { onChange(event.target.value); if (!event.target.value.trim()) setSuggestions([]); setOpen(true); }} />
      {open && suggestions.length > 0 && <div className="autocomplete-menu" id={`${id}-options`} role="listbox">
        {suggestions.map((item) => <button type="button" role="option" aria-selected={value === item.nickname} key={`${item.rank}-${item.nickname}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(item.nickname); setOpen(false); }}><span>{item.nickname}</span><small>{item.rank.toLocaleString()}위</small></button>)}
      </div>}
    </div>
  );
}

function HistoryFrameToggle({ value, onChange }: { value: HistoryFrame; onChange: (frame: HistoryFrame) => void }) {
  return <div className="history-frame-toggle" aria-label="차트 조회 단위">
    {([['hour', '1시간봉'], ['day', '일봉'], ['week', '주봉']] as const).map(([frame, label]) => <button type="button" className={value === frame ? "active" : ""} aria-pressed={value === frame} key={frame} onClick={() => onChange(frame)}>{label}</button>)}
  </div>;
}

function PlayerImage({ spid, name, wrapperClassName = "", preserveSpace = false }: {
  spid: string; name: string; wrapperClassName?: string; preserveSpace?: boolean;
}) {
  const [source, setSource] = useState<"official" | "player" | "missing">("official");
  const image = source === "official"
    ? `${apiBaseUrl}/api/players/${spid}/image`
    : `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p${spid}.png`;
  const content = source === "missing"
    ? (preserveSpace ? <span className="squad-player-image-missing" aria-label={`${name} 이미지 없음`} /> : null)
    : <img alt={`${name} 선수 이미지`} src={image} onError={() => setSource((current) => current === "official" ? "player" : "missing")} />;
  if (wrapperClassName) return <div className={`${wrapperClassName} ${source === "missing" ? "missing" : ""}`}>{content}</div>;
  return content;
}

function SeasonBadge({ season, image }: { season: string | null; image: string | null }) {
  const label = season || "시즌 정보 없음";
  return (
    <span className="season-badge" data-tooltip={`시즌명: ${label}`} title={`시즌명: ${label}`} tabIndex={0}>
      {image ? <img src={image} alt={`${label} 시즌`} /> : <span>{seasonLabel(season)}</span>}
    </span>
  );
}

function HistoryChart({ title, items, value, format, formatPoint, frame, change, lowerIsHigher = false }: {
  title: string;
  items: HistoryItem[];
  value: (item: HistoryItem) => number | null;
  format: (item: HistoryItem) => string;
  formatPoint: (point: number) => string;
  frame: HistoryFrame;
  change: (first: HistoryItem, last: HistoryItem) => HistoryChange;
  lowerIsHigher?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const chartItems = items.map((item) => ({ item, point: value(item) }))
    .filter((entry): entry is { item: HistoryItem; point: number } => entry.point != null && Number.isFinite(entry.point));
  const points = chartItems.map((entry) => entry.point);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [items, frame]);
  if (points.length < 2) return <div className="history-chart empty"><h4>{title}</h4><p>변화를 보여줄 기록이 아직 부족합니다.</p></div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const plotWidth = Math.max(300, 16 + (points.length - 1) * 56);
  const coordinates = chartItems.map(({ point }, index) => {
    const x = 8 + (index / Math.max(points.length - 1, 1)) * (plotWidth - 16);
    const ratio = (point - min) / (max - min);
    const y = max === min ? 70 : lowerIsHigher ? 20 + ratio * 110 : 130 - ratio * 110;
    return { x, y };
  });
  const active = activeIndex == null ? null : chartItems[activeIndex];
  const activeCoordinate = activeIndex == null ? null : coordinates[activeIndex];
  const line = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const changeResult = change(chartItems[0].item, chartItems.at(-1)!.item);
  const highest = lowerIsHigher ? min : max;
  const lowest = lowerIsHigher ? max : min;
  const average = points.reduce((sum, point) => sum + point, 0) / points.length;
  const finishDrag = (element: HTMLDivElement, pointerId: number) => {
    dragRef.current.active = false;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  };
  return <div className="history-chart" data-frame={frame}>
    <div><h4>{title}</h4><strong>{format(chartItems.at(-1)!.item)}</strong></div>
    <div
      className="history-chart-scroll"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragRef.current = { active: true, moved: false, startX: event.clientX, startLeft: event.currentTarget.scrollLeft };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current.active) return;
        const distance = event.clientX - dragRef.current.startX;
        if (Math.abs(distance) > 3) dragRef.current.moved = true;
        event.currentTarget.scrollLeft = dragRef.current.startLeft - distance;
      }}
      onPointerUp={(event) => finishDrag(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finishDrag(event.currentTarget, event.pointerId)}
      onWheel={(event) => {
        event.preventDefault();
        event.currentTarget.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      }}
      ref={scrollRef}
      role="region"
      aria-label={`${title} 이전 기록 탐색`}
      tabIndex={0}
    >
      <div className="history-chart-plot" onMouseLeave={() => setActiveIndex(null)} style={{ width: `${plotWidth}px` }}>
        <svg viewBox={`0 0 ${plotWidth} 140`} role="img" aria-label={`${title} 변화`} style={{ width: `${plotWidth}px` }}>
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {coordinates.map(({ x, y }, index) => {
            const label = `${historyTooltipLabel(chartItems[index].item.dataTime)}, ${format(chartItems[index].item)}`;
            return <circle
              className={activeIndex === index ? "active" : ""}
              cx={x}
              cy={y}
              fill="currentColor"
              key={`${chartItems[index].item.dataTime}-${index}`}
              onBlur={() => setActiveIndex(null)}
              onClick={() => { if (!dragRef.current.moved) setActiveIndex(index); }}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => { if (!dragRef.current.active) setActiveIndex(index); }}
              r={activeIndex === index ? 5 : 3.5}
              role="button"
              tabIndex={0}
              aria-label={label}
            />;
          })}
        </svg>
        {active && activeCoordinate && <div
          className={`history-chart-tooltip ${activeCoordinate.y < 60 ? "below" : ""}`}
          style={{
            left: `${Math.min(plotWidth - 72, Math.max(72, activeCoordinate.x))}px`,
            top: `${(activeCoordinate.y / 140) * 100}%`,
          }}
        ><span>{historyTooltipLabel(active.item.dataTime)}</span><b>{format(active.item)}</b></div>}
      </div>
    </div>
    <div className="history-chart-stats">
      <span>최고 <b>{formatPoint(highest)}</b></span>
      <span>최저 <b>{formatPoint(lowest)}</b></span>
      <span>평균 <b>{formatPoint(average)}</b></span>
    </div>
    <div className={`history-chart-change trend-${changeResult.trend}`}><span>{title}</span><b>{changeResult.label}</b></div>
  </div>;
}

export default function Home() {
  const [rankStart, setRankStart] = useState("1");
  const [rankEnd, setRankEnd] = useState("1000");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("ST");
  const [detailedPositions, setDetailedPositions] = useState(false);
  const [query, setQuery] = useState<Query>({ start: "1", end: "1000", team: "", position: "ST", detailed: false });
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [teamColors, setTeamColors] = useState<Array<{ name: string; managers: number }>>([]);
  const [result, setResult] = useState<PickResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [rankingTeam, setRankingTeam] = useState("");
  const [rankingResult, setRankingResult] = useState<RankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [rankingError, setRankingError] = useState("");
  const [rankingPage, setRankingPage] = useState(1);
  const [rankingNickname, setRankingNickname] = useState("");
  const [rankingSearchActive, setRankingSearchActive] = useState(false);
  const [rankingSearchLabel, setRankingSearchLabel] = useState("");
  const [profileNickname, setProfileNickname] = useState("");
  const [profileResult, setProfileResult] = useState<UserProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [historyFrame, setHistoryFrame] = useState<HistoryFrame>("hour");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesHasMore, setMatchesHasMore] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [modalNickname, setModalNickname] = useState("");
  const [modalProfile, setModalProfile] = useState<UserProfileResponse | null>(null);
  const [modalMatches, setModalMatches] = useState<MatchItem[]>([]);
  const [modalSelectedMatch, setModalSelectedMatch] = useState<MatchItem | null>(null);
  const [modalTab, setModalTab] = useState<"summary" | "squad" | "matches">("summary");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [modalHistoryFrame, setModalHistoryFrame] = useState<HistoryFrame>("hour");
  const modalRequest = useRef(0);
  const modalScrollPosition = useRef(0);
  const teamColorNames = teamColors.map((color) => color.name).sort((a, b) => a.localeCompare(b, "ko-KR"));

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

  async function loadRecentMatches(nickname: string, offset = 0, append = false) {
    setMatchesLoading(true);
    try {
      const parameters = new URLSearchParams({ nickname, offset: String(offset), limit: "20" });
      const response = await fetch(`${apiBaseUrl}/api/users/matches?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "최근 경기를 불러오지 못했습니다.");
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setMatches((current) => append ? [...current, ...nextItems] : nextItems);
      setMatchesHasMore(Boolean(payload.hasMore));
      if (!append) setSelectedMatch(nextItems[0] || null);
    } catch (requestError) {
      if (!append) setMatches([]);
      setProfileError(requestError instanceof Error ? requestError.message : "최근 경기를 불러오지 못했습니다.");
    } finally {
      setMatchesLoading(false);
    }
  }

  async function searchProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = profileNickname.trim();
    if (!nickname) return;
    setProfileLoading(true);
    setProfileError("");
    setProfileResult(null);
    setMatches([]);
    setSelectedMatch(null);
    try {
      const parameters = new URLSearchParams({ nickname });
      const response = await fetch(`${apiBaseUrl}/api/users/profile?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "구단주 정보를 불러오지 못했습니다.");
      setProfileResult(payload);
      if (payload.profile?.hasOuid) void loadRecentMatches(payload.profile.nickname);
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "구단주 정보를 불러오지 못했습니다.");
    } finally {
      setProfileLoading(false);
    }
  }

  async function openRankerModal(ranker: RankingItem) {
    const requestId = ++modalRequest.current;
    modalScrollPosition.current = window.scrollY;
    setModalNickname(ranker.nickname);
    setModalProfile(null);
    setModalMatches([]);
    setModalSelectedMatch(null);
    setModalTab("summary");
    setModalHistoryFrame("hour");
    setModalError("");
    setModalLoading(true);
    try {
      const profileParameters = new URLSearchParams({ nickname: ranker.nickname });
      const profileResponse = await fetch(`${apiBaseUrl}/api/users/profile?${profileParameters}`, { cache: "no-store" });
      const profilePayload = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profilePayload.message || "구단주 정보를 불러오지 못했습니다.");
      if (modalRequest.current !== requestId) return;
      setModalProfile(profilePayload);

      if (profilePayload.profile?.hasOuid) {
        const matchParameters = new URLSearchParams({ nickname: profilePayload.profile.nickname, offset: "0", limit: "20" });
        const matchResponse = await fetch(`${apiBaseUrl}/api/users/matches?${matchParameters}`, { cache: "no-store" });
        const matchPayload = await matchResponse.json();
        if (modalRequest.current !== requestId) return;
        if (matchResponse.ok) {
          const items = Array.isArray(matchPayload.items) ? matchPayload.items : [];
          setModalMatches(items);
          setModalSelectedMatch(items[0] || null);
        }
      }
    } catch (requestError) {
      if (modalRequest.current === requestId) setModalError(requestError instanceof Error ? requestError.message : "구단주 정보를 불러오지 못했습니다.");
    } finally {
      if (modalRequest.current === requestId) setModalLoading(false);
    }
  }

  function closeRankerModal() {
    modalRequest.current += 1;
    setModalNickname("");
    window.requestAnimationFrame(() => window.scrollTo({ top: modalScrollPosition.current, behavior: "auto" }));
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
      detailedPositions: String(nextQuery.detailed),
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
      detailedPositions: String(nextQuery.detailed),
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
    const nickname = rankingNickname.trim();
    if (!nickname) {
      if (rankingSearchActive) {
        const timer = window.setTimeout(() => void fetchRankings(rankingTeam, 1), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRankingLoading(true);
      setRankingError("");
      try {
        const parameters = new URLSearchParams({ nickname });
        const response = await fetch(`${apiBaseUrl}/api/rankings/search?${parameters}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "구단주 검색에 실패했습니다.");
        setRankingResult(payload);
        setRankingPage(1);
        setRankingSearchActive(true);
        setRankingSearchLabel(nickname);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setRankingResult(null);
        setRankingError(requestError instanceof Error ? requestError.message : "구단주 검색에 실패했습니다.");
      } finally {
        if (!controller.signal.aborted) setRankingLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Nickname changes are the only trigger; ranking/team state is handled inside each request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingNickname]);

  useEffect(() => {
    if (!modalNickname) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRankerModal();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modalNickname]);

  async function applyFilters() {
    setHasSearched(true);
    setLoading(true);
    setResult(null);
    setError("");
    const baseQuery = { start: rankStart, end: rankEnd, team, detailed: detailedPositions };
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
    const nextQuery = { start: rankStart, end: rankEnd, team, position: nextPosition, detailed: detailedPositions };
    setQuery(nextQuery);
    void fetchPicks(nextQuery);
  }

  async function toggleDetailedPositions() {
    const nextDetailed = !detailedPositions;
    setDetailedPositions(nextDetailed);
    if (!hasSearched) return;

    const baseQuery = { start: rankStart, end: rankEnd, team, detailed: nextDetailed };
    const available = await fetchAvailablePositions(baseQuery);
    const nextPosition = available.includes(position) ? position : (available[0] || position);
    setPosition(nextPosition);
    const nextQuery = { ...baseQuery, position: nextPosition };
    setQuery(nextQuery);
    await fetchPicks(nextQuery);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="FC-SUPPORT 홈">
          <span className="brand-mark">FC</span><span>SUPPORT</span>
        </a>
        <nav aria-label="주요 메뉴">
          <a className="active" href="#analysis">픽률 분석</a>
          <a href="#user-search">구단주 검색</a>
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

          <div className="select-field">
            <TeamAutocomplete id="pick-team-color" label="팀컬러" value={team} options={teamColorNames} onChange={setTeam} />
          </div>

          <button className="search-button" type="submit" disabled={loading}>
            <span>{loading ? "조회 중" : "픽률 조회"}</span><b aria-hidden="true">↗</b>
          </button>
        </form>

        <div className="results-layout">
          <aside className="position-panel">
            <div className="position-panel-heading">
              <p>POSITION</p>
              <button type="button" className={detailedPositions ? "active" : ""} aria-pressed={detailedPositions} onClick={() => void toggleDetailedPositions()}>
                <span>상세 포지션</span><b>{detailedPositions ? "ON" : "OFF"}</b>
              </button>
            </div>
            <div className="position-grid">
              {!hasSearched ? <p className="position-empty">조회 후 사용할 수 있는 포지션이 표시됩니다.</p> : availablePositions.length > 0 ? availablePositions.map((item) => (
                <button className={position === item ? "selected" : ""} key={item} onClick={() => selectPosition(item)} type="button">{item}</button>
              )) : <p className="position-empty">사용 데이터가 있는 포지션이 없습니다.</p>}
            </div>
            <div className="position-note"><span>선발 기준</span>교체 선수와 상대 선수는 집계에서 제외됩니다.</div>
          </aside>

          <div className="result-content">
            {hasSearched && <div className="result-topline">
              <div><p>{integerLabel(query.start)}–{integerLabel(query.end)}위 · {query.team || "전체 팀"}</p><h3>{query.position} 픽률</h3></div>
              {result && (
                <div className="result-stats">
                  <span><b>{result.matchingManagers.toLocaleString()}</b> 감독</span>
                  <span><b>{result.positionTotal.toLocaleString()}</b> {query.position} 기용</span>
                </div>
              )}
            </div>}

            {!hasSearched ? (
              <div className="empty-state"><span>NO RESULT</span><h4>검색 결과가 없습니다.</h4><p>순위와 팀컬러를 선택한 뒤 픽률 조회를 눌러주세요.</p></div>
            ) : loading ? (
              <div className="empty-state"><span>LOADING</span><h4>수집된 데이터를 확인하고 있습니다.</h4></div>
            ) : error ? (
              <div className="empty-state"><span>NO DATA</span><h4>{error}</h4><p>데이터를 임의로 생성하지 않습니다.<br />수집이 완료되면 실제 결과만 표시됩니다.</p></div>
            ) : result && result.items.length > 0 ? (
              <>
                <div className="player-list">
                  {result.items.map((player, index) => (
                    <article className="player-row" key={`${player.spid}-${player.grade}`}>
                      <span className="list-rank">{String(index + 1).padStart(2, "0")}</span>
                      <PlayerImage spid={player.spid} name={player.name || "선수"} wrapperClassName="player-photo" />
                      <div className="player-identity">
                        <div><SeasonBadge season={player.season} image={player.seasonImage} /><b>+{player.grade}</b></div>
                        <h4>{player.name || "선수명 정보 없음"}</h4>
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
        </div>
      </section>

      <section className="user-search-section" id="user-search">
        <div className="user-search-heading">
          <div><p className="section-kicker">MANAGER PROFILE</p><h2>구단주 검색</h2><p>닉네임으로 순위 변화, 스쿼드와 최근 경기를 확인하세요.</p></div>
          <form className="profile-search-form" onSubmit={searchProfile}>
            <NicknameAutocomplete id="profile-nickname" label="구단주 닉네임" value={profileNickname} onChange={setProfileNickname} />
            <button type="submit" disabled={profileLoading}>{profileLoading ? "검색 중" : "검색"}</button>
          </form>
        </div>

        {profileError ? <div className="profile-empty error">{profileError}</div> : profileLoading ? <div className="profile-empty">구단주 정보를 불러오는 중입니다.</div> : profileResult ? (
          <div className="profile-dashboard">
            <div className="profile-summary">
              <div><span>{profileResult.profile.rank.toLocaleString()}위</span><h3>{profileResult.profile.nickname}</h3><p>{profileResult.profile.primaryTeamColor || "팀컬러 없음"} · {profileResult.profile.formation || "포메이션 정보 없음"}</p></div>
              <dl>
                <div><dt>구단가치</dt><dd>{clubValueLabel(profileResult.profile.clubValue)}</dd></div>
                <div><dt>최근 승률</dt><dd>{profileResult.profile.winRate == null ? "정보 없음" : `${profileResult.profile.winRate.toFixed(1)}%`}</dd></div>
                <div><dt>경기 기록</dt><dd>{integerLabel(profileResult.profile.wins)}승 {integerLabel(profileResult.profile.draws)}무 {integerLabel(profileResult.profile.losses)}패</dd></div>
                <div><dt>점수</dt><dd>{profileResult.profile.elo?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? "정보 없음"}</dd></div>
              </dl>
            </div>

            <div className="history-toolbar"><span>기록 조회 단위</span><HistoryFrameToggle value={historyFrame} onChange={setHistoryFrame} /></div>
            <small className="history-navigation-guide">차트를 좌우로 드래그하거나 휠을 움직이면 이전 기록을 볼 수 있습니다.</small>
            <div className="history-grid">
              <HistoryChart title="순위 변화" items={aggregateHistory(profileResult.history, historyFrame)} frame={historyFrame} value={(item) => item.rank} format={(item) => `${item.rank.toLocaleString()}위`} formatPoint={(point) => `${Math.round(point).toLocaleString()}위`} change={rankHistoryChange} lowerIsHigher />
              <HistoryChart title="구단가치 변화" items={aggregateHistory(profileResult.history, historyFrame)} frame={historyFrame} value={(item) => Number(BigInt(item.clubValue) / 1_000_000_000_000n)} format={(item) => clubValueLabel(item.clubValue)} formatPoint={historyClubValueLabel} change={clubValueHistoryChange} />
              <HistoryChart title="승률 변화" items={aggregateHistory(profileResult.history, historyFrame)} frame={historyFrame} value={(item) => item.winRate} format={(item) => item.winRate == null ? "정보 없음" : `${item.winRate.toFixed(1)}%`} formatPoint={(point) => `${point.toFixed(1)}%`} change={winRateHistoryChange} />
            </div>

            <div className="profile-block">
              <div className="profile-block-heading"><div><span>CURRENT SQUAD</span><h3>현재 선발 스쿼드</h3></div><b>{profileResult.squad.length}명</b></div>
              {profileResult.squad.length > 0 ? <div className="squad-grid">{orderedSquad(profileResult.squad).map((player) => (
                <article className={`position-${positionGroup(player.position)}`} key={`${player.slot}-${player.spid}`}><span>{player.position || "—"}</span><PlayerImage spid={player.spid} name={player.name || "선수"} preserveSpace /><div><b title={player.name || "선수명 정보 없음"}>{player.name || "선수명 정보 없음"}</b><small className="squad-season"><SeasonBadge season={player.season} image={player.seasonImage} /><span>+{player.grade}</span></small></div></article>
              ))}</div> : <div className="profile-empty">저장된 선발 스쿼드가 없습니다.</div>}
            </div>

            <div className="profile-block match-block">
              <div className="profile-block-heading"><div><span>RECENT MATCHES</span><h3>최근 경기</h3></div><b>{matches.length}경기</b></div>
              <div className="matches-layout">
                <div className="match-list">
                  {matches.length === 0 && !matchesLoading ? <div className="profile-empty">최근 감독모드 경기가 없습니다.</div> : matches.map((match) => (
                    <button className={selectedMatch?.matchId === match.matchId ? "selected" : ""} type="button" key={match.matchId} onClick={() => setSelectedMatch(match)}>
                      <span className={`match-result result-${match.self?.result || "없음"}`}>{match.self?.result || "결과 없음"}</span>
                      <div><b>{match.self?.nickname || profileResult.profile.nickname} {match.self?.score ?? 0} : {match.opponent?.score ?? 0} {match.opponent?.nickname || "상대 정보 없음"}</b><small>{String(match.matchDate || "").replace("T", " ").slice(0, 16)}</small></div>
                    </button>
                  ))}
                  {matchesHasMore && <button className="matches-more" type="button" disabled={matchesLoading} onClick={() => void loadRecentMatches(profileResult.profile.nickname, matches.length, true)}>{matchesLoading ? "불러오는 중" : "20경기 더 보기"}</button>}
                </div>
                <div className="match-detail">
                  {selectedMatch?.self && selectedMatch.opponent ? <>
                    <div className="match-score"><span>{selectedMatch.self.nickname}</span><strong>{selectedMatch.self.score} : {selectedMatch.opponent.score}</strong><span>{selectedMatch.opponent.nickname}</span></div>
                    {[
                      ["점유율", `${selectedMatch.self.possession}%`, `${selectedMatch.opponent.possession}%`],
                      ["슈팅", selectedMatch.self.shots, selectedMatch.opponent.shots],
                      ["유효 슈팅", selectedMatch.self.effectiveShots, selectedMatch.opponent.effectiveShots],
                      ["패스 성공", `${selectedMatch.self.passSuccess}/${selectedMatch.self.passTry}`, `${selectedMatch.opponent.passSuccess}/${selectedMatch.opponent.passTry}`],
                      ["파울", selectedMatch.self.fouls, selectedMatch.opponent.fouls],
                      ["코너킥", selectedMatch.self.corners, selectedMatch.opponent.corners],
                    ].map(([label, selfValue, opponentValue]) => <div className="match-stat" key={String(label)}><b>{selfValue}</b><span>{label}</span><b>{opponentValue}</b></div>)}
                  </> : <div className="profile-empty">경기를 선택하면 상세 내용이 표시됩니다.</div>}
                </div>
              </div>
            </div>
          </div>
        ) : <div className="profile-empty">구단주를 검색하면 저장된 정보와 최근 경기가 표시됩니다.</div>}
      </section>

      <section className="ranking-section" id="ranking">
        <div className="ranking-heading">
          <div>
            <p className="section-kicker">MANAGER MODE RANKING</p>
            <h2>감독모드 랭킹</h2>
            <p className="ranking-description">FC 온라인 감독모드 상위 10,000명의 순위와 팀 정보를 확인하세요.</p>
          </div>
          <div className="ranking-controls">
            <form className="ranking-search" onSubmit={searchRanking}>
              <NicknameAutocomplete id="ranking-nickname" label="구단주 닉네임 검색" value={rankingNickname} onChange={setRankingNickname} />
            </form>
            <div className="ranking-filter">
              <TeamAutocomplete id="ranking-team-color" label="팀컬러 필터" value={rankingTeam} options={teamColorNames} onChange={setRankingTeam} onSelect={(nextTeam) => { setRankingNickname(""); void fetchRankings(nextTeam, 1); }} />
            </div>
          </div>
        </div>

        <div className="ranking-board">
          <div className="ranking-board-meta">
            <span>{rankingSearchActive ? `NICKNAME · ${rankingSearchLabel}` : rankingTeam || "ALL TEAM COLORS"}</span>
            <p>{rankingResult ? `${rankingResult.total.toLocaleString()}명 · ${simpleSnapshotLabel(rankingResult.snapshot.data_time)}` : "데이터 없음"}</p>
          </div>
          <div className="ranking-table-head" aria-hidden="true">
            <span>순위</span><span>구단주</span><span>팀컬러</span><span>포메이션</span><span>점수</span><span>승률</span><span>구단가치</span>
          </div>

          {rankingLoading ? (
            <div className="ranking-empty">실제 랭킹을 불러오는 중입니다.</div>
          ) : rankingError ? (
            <div className="ranking-empty error">{rankingError}</div>
          ) : rankingResult && rankingResult.items.length > 0 ? (
            <div className="ranking-list">
              {rankingResult.items.map((ranker) => (
                <article
                  className={`ranking-row ${ranker.rank <= 3 ? "podium" : ""}`}
                  key={`${ranker.rank}-${ranker.nexonSn}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${ranker.nickname} 구단주 정보 보기`}
                  onClick={() => void openRankerModal(ranker)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openRankerModal(ranker);
                    }
                  }}
                >
                  <strong className="ranking-number">{integerLabel(ranker.rank, 2)}<RankDelta current={ranker.rank} previous={ranker.previousRank} /></strong>
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
                  <div className="ranking-record"><b>{ranker.winRate == null ? "—" : `${ranker.winRate.toFixed(1)}%`}</b><WinRateDelta current={ranker.winRate} previous={ranker.previousWinRate} /><small>{integerLabel(ranker.wins)}승 {integerLabel(ranker.draws)}무 {integerLabel(ranker.losses)}패</small></div>
                  <span className="ranking-value">{clubValueLabel(ranker.clubValue)}<ClubValueDelta current={ranker.clubValue} previous={ranker.previousClubValue} /></span>
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

      {modalNickname && (
        <div className="ranker-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRankerModal(); }}>
          <section className="ranker-modal" role="dialog" aria-modal="true" aria-labelledby="ranker-modal-title">
            <header className="ranker-modal-header">
              <div><span>MANAGER PROFILE</span><h2 id="ranker-modal-title">{modalNickname}</h2></div>
              <button type="button" onClick={closeRankerModal} aria-label="구단주 정보 닫기">×</button>
            </header>
            <nav className="ranker-modal-tabs" aria-label="구단주 상세 정보">
              {([['summary', '요약'], ['squad', '선발 스쿼드'], ['matches', '최근 경기']] as const).map(([tab, label]) => (
                <button type="button" className={modalTab === tab ? "active" : ""} aria-pressed={modalTab === tab} key={tab} onClick={() => setModalTab(tab)}>{label}</button>
              ))}
            </nav>
            <div className="ranker-modal-body">
              {modalLoading && !modalProfile ? <div className="modal-state">구단주 정보를 불러오는 중입니다.</div> : modalError ? <div className="modal-state error">{modalError}</div> : modalProfile ? (
                <>
                  {modalTab === "summary" && (
                    <div className="modal-summary-tab">
                      <div className="modal-manager-summary">
                        <div><span>{modalProfile.profile.rank.toLocaleString()}위</span><h3>{modalProfile.profile.nickname}</h3><p>{modalProfile.profile.primaryTeamColor || "팀컬러 없음"} · {modalProfile.profile.formation || "포메이션 정보 없음"}</p></div>
                        <dl>
                          <div><dt>구단가치</dt><dd>{clubValueLabel(modalProfile.profile.clubValue)}</dd></div>
                          <div><dt>최근 승률</dt><dd>{modalProfile.profile.winRate == null ? "정보 없음" : `${modalProfile.profile.winRate.toFixed(1)}%`}</dd></div>
                          <div><dt>경기 기록</dt><dd>{integerLabel(modalProfile.profile.wins)}승 {integerLabel(modalProfile.profile.draws)}무 {integerLabel(modalProfile.profile.losses)}패</dd></div>
                          <div><dt>점수</dt><dd>{modalProfile.profile.elo?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? "정보 없음"}</dd></div>
                        </dl>
                      </div>
                      <div className="history-toolbar"><span>기록 조회 단위</span><HistoryFrameToggle value={modalHistoryFrame} onChange={setModalHistoryFrame} /></div>
                      <small className="history-navigation-guide">차트를 좌우로 드래그하거나 휠을 움직이면 이전 기록을 볼 수 있습니다.</small>
                      <div className="history-grid">
                        <HistoryChart title="순위 변화" items={aggregateHistory(modalProfile.history, modalHistoryFrame)} frame={modalHistoryFrame} value={(item) => item.rank} format={(item) => `${item.rank.toLocaleString()}위`} formatPoint={(point) => `${Math.round(point).toLocaleString()}위`} change={rankHistoryChange} lowerIsHigher />
                        <HistoryChart title="구단가치 변화" items={aggregateHistory(modalProfile.history, modalHistoryFrame)} frame={modalHistoryFrame} value={(item) => Number(BigInt(item.clubValue) / 1_000_000_000_000n)} format={(item) => clubValueLabel(item.clubValue)} formatPoint={historyClubValueLabel} change={clubValueHistoryChange} />
                        <HistoryChart title="승률 변화" items={aggregateHistory(modalProfile.history, modalHistoryFrame)} frame={modalHistoryFrame} value={(item) => item.winRate} format={(item) => item.winRate == null ? "정보 없음" : `${item.winRate.toFixed(1)}%`} formatPoint={(point) => `${point.toFixed(1)}%`} change={winRateHistoryChange} />
                      </div>
                    </div>
                  )}
                  {modalTab === "squad" && (
                    <div className="modal-content-block">
                      <div className="profile-block-heading"><div><span>CURRENT SQUAD</span><h3>현재 선발 스쿼드</h3></div><b>{modalProfile.squad.length}명</b></div>
                      {modalProfile.squad.length > 0 ? <div className="squad-grid">{orderedSquad(modalProfile.squad).map((player) => (
                        <article className={`position-${positionGroup(player.position)}`} key={`${player.slot}-${player.spid}`}><span>{player.position || "—"}</span><PlayerImage spid={player.spid} name={player.name || "선수"} preserveSpace /><div><b title={player.name || "선수명 정보 없음"}>{player.name || "선수명 정보 없음"}</b><small className="squad-season"><SeasonBadge season={player.season} image={player.seasonImage} /><span>+{player.grade}</span></small></div></article>
                      ))}</div> : <div className="modal-state">저장된 선발 스쿼드가 없습니다.</div>}
                    </div>
                  )}
                  {modalTab === "matches" && (
                    <div className="modal-content-block matches-layout">
                      <div className="match-list">
                        {modalMatches.length > 0 ? modalMatches.map((match) => (
                          <button className={modalSelectedMatch?.matchId === match.matchId ? "selected" : ""} type="button" key={match.matchId} onClick={() => setModalSelectedMatch(match)}>
                            <span className={`match-result result-${match.self?.result || "없음"}`}>{match.self?.result || "결과 없음"}</span>
                            <div><b>{match.self?.nickname || modalNickname} {match.self?.score ?? 0} : {match.opponent?.score ?? 0} {match.opponent?.nickname || "상대 정보 없음"}</b><small>{String(match.matchDate || "").replace("T", " ").slice(0, 16)}</small></div>
                          </button>
                        )) : <div className="modal-state">최근 감독모드 경기가 없습니다.</div>}
                      </div>
                      <div className="match-detail">
                        {modalSelectedMatch?.self && modalSelectedMatch.opponent ? <>
                          <div className="match-score"><span>{modalSelectedMatch.self.nickname}</span><strong>{modalSelectedMatch.self.score} : {modalSelectedMatch.opponent.score}</strong><span>{modalSelectedMatch.opponent.nickname}</span></div>
                          {[["점유율", `${modalSelectedMatch.self.possession}%`, `${modalSelectedMatch.opponent.possession}%`], ["슈팅", modalSelectedMatch.self.shots, modalSelectedMatch.opponent.shots], ["유효 슈팅", modalSelectedMatch.self.effectiveShots, modalSelectedMatch.opponent.effectiveShots], ["패스 성공", `${modalSelectedMatch.self.passSuccess}/${modalSelectedMatch.self.passTry}`, `${modalSelectedMatch.opponent.passSuccess}/${modalSelectedMatch.opponent.passTry}`], ["파울", modalSelectedMatch.self.fouls, modalSelectedMatch.opponent.fouls], ["코너킥", modalSelectedMatch.self.corners, modalSelectedMatch.opponent.corners]].map(([label, selfValue, opponentValue]) => <div className="match-stat" key={String(label)}><b>{selfValue}</b><span>{label}</span><b>{opponentValue}</b></div>)}
                        </> : <div className="profile-empty">경기를 선택하면 상세 내용이 표시됩니다.</div>}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}

      <section className="community-section" id="community">
        <div><p className="section-kicker">FC-SUPPORT COMMUNITY</p><h2>데이터 다음은,<br />당신의 전술.</h2></div>
        <div className="community-copy"><p>픽률을 확인하고, 스쿼드를 공유하고,<br />감독모드 이야기를 이어가세요.</p><button type="button">커뮤니티 준비 중 <span>→</span></button></div>
      </section>

      <footer><a className="brand footer-brand" href="#top"><span className="brand-mark">FC</span><span>SUPPORT</span></a><p>Data based on NEXON Open API</p><small>FC-SUPPORT is not associated with or endorsed by NEXON Korea.</small></footer>
    </main>
  );
}
