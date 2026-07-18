# FC-SUPPORT 아키텍처

## 목표

FC-SUPPORT는 FC 온라인 감독모드 상위 10,000명의 실제 데이터를 한 시간 단위로 수집하면서도 조회 사용자가 수집 중인 불완전한 데이터를 보지 않도록 설계했습니다. 프론트엔드 요청은 NEXON API를 직접 호출하지 않고, 검증이 끝난 활성 SQLite 스냅샷만 조회합니다.

## 시스템 구성

```mermaid
flowchart LR
    U["웹 사용자"] --> P["localhost:3000 무중단 프록시"]
    P --> F["React 19 + Next.js UI"]
    F --> B["Node.js HTTP API"]
    B --> D[("SQLite WAL DB")]
    S["KST 매시 05분 스케줄러"] --> C["수집기"]
    C --> R["FC 온라인 공식 랭킹"]
    C --> N["NEXON Open API"]
    C --> M["공식 메타데이터·CDN"]
    C --> D
    T["분리된 테스트 환경 3001/8788"] --> TD[("복제 테스트 DB")]
    G["GitHub Actions"] --> V["빌드 + 자동 테스트"]
```

## 수집 파이프라인

```mermaid
flowchart TD
    A["감독모드 랭킹 500페이지"] --> B["랭커 10,000명 저장"]
    B --> C["닉네임 → OUID"]
    C --> D["최근 감독모드 매치 ID"]
    D --> E["매치 상세 조회"]
    E --> F["본인 선발·포지션·강화단계 추출"]
    F --> G["SPID·시즌·포지션 메타데이터 결합"]
    G --> H["building 스냅샷 검증"]
    H -->|완료| I["기존 active → retained"]
    I --> J["새 스냅샷 → active"]
    H -->|실패| K["failed 처리, 기존 active 유지"]
```

- 여섯 개 API 키는 작업 큐에서 함께 사용하지만, 최종 결과는 하나의 스냅샷으로 묶습니다.
- 서버 재시작으로 중단된 `building` 스냅샷은 실패 처리하고 활성 스냅샷을 유지합니다.
- 활성 스냅샷은 한 개, 복구용 이전 스냅샷은 한 개만 남깁니다.
- 순위·구단가치·승률 이력은 30일 동안 별도 보관합니다.

## DB ERD

```mermaid
erDiagram
    snapshots ||--o{ ranking_entries : contains
    rankers ||--o{ ranking_entries : ranked_as
    snapshots ||--o{ lineup_players : contains
    rankers ||--o{ lineup_players : fields
    player_metadata ||--o{ lineup_players : describes
    rankers ||--o{ ranking_history : tracks
    snapshots ||--o{ squad_profile_cache : caches
    rankers ||--o{ squad_profile_cache : owns
    community_users ||--o{ community_sessions : authenticates
    community_users ||--o{ community_posts : writes
    community_users ||--o{ community_comments : writes
    community_posts ||--o{ community_comments : contains

    snapshots {
      integer id PK
      text data_time
      text status
      integer ranking_count
      integer lineup_count
      integer failure_count
    }
    rankers {
      integer id PK
      text nexon_sn UK
      text nickname
      text ouid UK
    }
    ranking_entries {
      integer snapshot_id PK,FK
      integer ranker_id PK,FK
      integer rank
      integer club_value
      real win_rate
      text team_colors_json
      text formation
    }
    lineup_players {
      integer snapshot_id PK,FK
      integer ranker_id PK,FK
      integer slot PK
      integer spid
      integer position_id
      integer grade
    }
    player_metadata {
      integer spid PK
      integer pid
      integer season_id
      text name
    }
    ranking_history {
      integer ranker_id PK,FK
      text data_time PK
      integer rank
      integer club_value
      real win_rate
    }
    community_users {
      integer id PK
      text login_id UK
      text nickname UK
      text password_hash
    }
    community_sessions {
      text token_hash PK
      integer user_id FK
      text expires_at
    }
    community_posts {
      integer id PK
      integer author_id FK
      text title
      text content
    }
    community_comments {
      integer id PK
      integer post_id FK
      integer author_id FK
      text content
    }
```

## 일관성과 장애 대응

1. SQLite는 WAL, foreign key, busy timeout을 활성화합니다.
2. 수집은 DB 잠금으로 중복 실행을 방지합니다.
3. 새 스냅샷은 모든 단계가 끝날 때까지 사용자 조회에서 제외됩니다.
4. 승격은 하나의 트랜잭션에서 수행합니다.
5. 테스트 환경은 운영 DB의 SQLite 스냅샷 복제본을 사용합니다.
6. 배포는 새 서버의 빌드·테스트·헬스체크가 끝난 후 프록시 연결만 전환합니다.

## 인증과 커뮤니티

- 비밀번호는 Node.js `scrypt`와 사용자별 salt로 해시합니다.
- 세션 원문은 DB에 저장하지 않고 SHA-256 해시만 저장합니다.
- 브라우저에는 `HttpOnly`, `SameSite=Lax` 쿠키를 사용합니다.
- 게시글과 댓글은 공개 조회이며, 작성은 로그인 회원만 가능합니다.
- 삭제 권한은 UI가 아니라 서버에서 작성자 ID로 다시 검사합니다.
