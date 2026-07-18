"use client";

import { useEffect, useState } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";
const repositoryUrl = "https://github.com/kinngh00/fc-support";

type PortfolioMetrics = {
  snapshot: { id: number; dataTime: string; completedAt: string } | null;
  collection: {
    rankingCount: number;
    lineupCount: number;
    failureCount: number;
    successfulCount: number;
    successRate: number | null;
    durationSeconds: number | null;
  } | null;
  community: { members: number; posts: number; comments: number };
};

function durationLabel(seconds: number | null) {
  if (seconds == null) return "측정 정보 없음";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes.toLocaleString()}분 ${rest}초` : `${rest}초`;
}

export function PortfolioSection() {
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/api/portfolio/metrics`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("metrics unavailable");
        setMetrics(await response.json());
      })
      .catch((requestError) => {
        if ((requestError as Error).name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, []);

  const collection = metrics?.collection;

  return <section className="portfolio-section" id="portfolio">
    <div className="portfolio-intro">
      <div>
        <p className="section-kicker">AI-NATIVE DEVELOPMENT</p>
        <h2>AI를 사용한 결과가 아니라,<br /><em>검증 가능한 제품</em>을 만들었습니다.</h2>
      </div>
      <p>비정형 랭킹 수집부터 10,000명 단위 집계, 스냅샷 교체, 회원 커뮤니티와 무중단 배포까지 실제 동작하는 하나의 서비스로 연결했습니다. AI의 제안을 실제 API 응답, DB 결과, 자동 테스트와 화면 캡처로 검증했습니다.</p>
    </div>

    <div className="portfolio-metrics" aria-label="실제 활성 데이터 수집 지표">
      <div><span>수집 랭커</span><strong>{collection ? collection.rankingCount.toLocaleString() : "—"}</strong><small>활성 데이터 기준</small></div>
      <div><span>처리 성공률</span><strong>{collection?.successRate == null ? "—" : `${collection.successRate.toFixed(2)}%`}</strong><small>수집 인원 대비 실패 제외</small></div>
      <div><span>수집 소요 시간</span><strong>{collection ? durationLabel(collection.durationSeconds) : "—"}</strong><small>시작부터 활성화까지</small></div>
      <div><span>저장 선발 슬롯</span><strong>{collection ? collection.lineupCount.toLocaleString() : "—"}</strong><small>최신 활성 데이터 기준</small></div>
    </div>
    {error || (metrics && !metrics.snapshot) ? <p className="portfolio-metrics-note">현재 활성 수집 데이터가 없어 실제 지표를 표시하지 않습니다.</p> : collection ? <p className="portfolio-metrics-note">실패 {collection.failureCount.toLocaleString()}건 · 성공 {collection.successfulCount.toLocaleString()}건 · 스냅샷 #{metrics?.snapshot?.id}</p> : <p className="portfolio-metrics-note">실제 운영 지표를 확인하는 중입니다.</p>}

    <div className="portfolio-cases">
      <article><span>01 · DATA PIPELINE</span><h3>여섯 개 API 키를 하나의 일관된 데이터로</h3><p>랭킹, OUID, 최근 매치, 선발 선수와 메타데이터를 단계별로 수집합니다. 새 데이터가 완성되기 전까지 기존 활성 스냅샷을 유지합니다.</p></article>
      <article><span>02 · GUARDRAILS</span><h3>AI의 추정 대신 실제 응답을 기준으로</h3><p>더미 데이터와 임의 보정을 금지하고, API가 제공하지 않는 값은 없다고 표시합니다. 변경 범위 선언과 요구사항별 검증 근거로 의도하지 않은 수정을 차단합니다.</p></article>
      <article><span>03 · DELIVERY</span><h3>테스트에서 실패하고 운영은 유지되도록</h3><p>분리된 테스트 DB와 환경에서 먼저 확인하고, 빌드와 테스트를 통과한 새 서버만 연결합니다. 실패하면 기존 운영 연결은 그대로 유지됩니다.</p></article>
    </div>

    <div className="portfolio-links">
      <div><span>PROJECT DOCUMENTATION</span><h3>설계와 검증 과정을 코드 옆에 남겼습니다.</h3></div>
      <nav aria-label="포트폴리오 문서">
        <a href={`${repositoryUrl}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">아키텍처 · ERD <b>↗</b></a>
        <a href={`${repositoryUrl}/blob/main/docs/AI_NATIVE_DEVELOPMENT.md`} target="_blank" rel="noreferrer">AI 협업 · 검증 기록 <b>↗</b></a>
        <a href={`${repositoryUrl}/blob/main/docs/DEMO.md`} target="_blank" rel="noreferrer">3분 데모 가이드 <b>↗</b></a>
        <a href={repositoryUrl} target="_blank" rel="noreferrer">GitHub 저장소 <b>↗</b></a>
      </nav>
    </div>
  </section>;
}
