# 작업 인수인계 노트

이 문서는 hiátus(자작 캐릭터 챗봇 앱) 저장소에서 Claude Code와 진행한
긴 세션 동안 내려진 설계 결정과 컨벤션을 정리한 것입니다. 다른 AI
코딩 도구(Codex 등)나 다른 세션으로 작업을 이어갈 때, 이 코드베이스가
"왜 지금 이 모양인지"를 빠르게 파악하는 용도입니다.

각 결정의 더 자세한 배경은 실제 코드 주석과 git 커밋 메시지에도
남아 있습니다 — 이 문서는 그걸 관통하는 요약이라고 보면 됩니다.

## 저장소 기본 정보

- 레포: `gomnyang0412-ui/ver1`
- 작업 브랜치: `claude/character-chatbot-app-1dak03` — 매 작업 단위가
  끝날 때마다 `main`에 **fast-forward merge**로 즉시 반영해서 둘을
  계속 동일하게 유지해왔습니다(`git merge --ff-only`). 별도 PR 리뷰
  과정 없이 바로 push하는 개인 프로젝트라 이 패턴이 정착됐습니다.
- 스택: Next.js 16.3.0 (App Router) + TypeScript + Tailwind CSS v4,
  Vercel 배포, Upstash Redis(`lib/db.ts`, 서버 전용), `@google/genai`
  SDK(`lib/gemini.ts`에 집중).
- 로그인 없음(개인용 — 주소를 아는 사람만 접근). `README.md` 참고.

## 매 작업마다 반복한 검증 워크플로우

1. `npx tsc --noEmit`
2. `npx eslint <건드린 파일들>` — 전체 린트가 아니라 이번에 수정한
   파일만. 아래 "알려진 pre-existing 린트 이슈" 항목은 무시하되,
   **새 인스턴스를 만들지 않았는지**는 diff로 반드시 확인.
3. `rm -rf .next && npm run build`
4. `npm run dev` 백그라운드 실행 후 `curl`로 주요 화면 200 확인,
   필요하면 Playwright로 스크린샷까지 찍어서 실제 렌더링 확인
   (이 샌드박스엔 Redis 자격증명이 없어서 "서버에 데이터베이스가
   연결되어 있지 않아요" 메시지가 뜨는 건 정상 — 매번 이걸로 스모크
   테스트를 검증했음, 새로운 오류가 아님).
5. `git add <파일들>`(특정 파일만, `-A`/`.` 지양) → 한국어로 구조화된
   커밋 메시지(무엇을·왜) → `claude/character-chatbot-app-1dak03`에
   push → `main`으로 체크아웃해 `--ff-only` 머지 → `main` push.

## 알려진 pre-existing 린트 이슈 (건드리지 않아도 됨)

- `react-hooks/purity` — "Cannot call impure function during render"
  (`Date.now()`를 이벤트 핸들러 안에서 직접 호출하는 패턴). 여러
  화면(`app/observe/page.tsx`, `app/thread/[threadId]/page.tsx` 등)에
  이 세션 이전부터 존재. 고치려면 상당한 리팩터가 필요해 보류 중.
- `react-hooks/set-state-in-effect` — 마운트 `useEffect`에서 로딩
  상태를 동기적으로 초기화하는 패턴. 마찬가지로 기존 관습.
- 이 두 카테고리는 계속 "새 인스턴스만 늘리지 않으면 통과"로 다뤄왔음.
  다른 카테고리의 새 오류가 나오면 반드시 고쳐야 함.

## 핵심 데이터 모델 (`lib/types.ts`)

- **`Room` / `RoomItem`** — 1:1 채팅과 멀티 대화방을 완전히 통합한
  모델. `kind: "single" | "group"`, `characterIds.length`가 1이면
  single(id는 항상 `single-{characterId}`), 2개 이상이면 group. 예전엔
  `ChatMessage`/`MultiThread`가 따로 있었는데, 세션 초반에 완전히
  통합했음(레거시 키는 `lib/db.ts`가 최초 읽기 시 자동·지연·멱등
  마이그레이션 — `getRooms()` 참고).
- **`ObservationSession` / `StoryEpisode`** — 관찰 모드(비주얼노벨풍
  단편소설 연작). `episodes[]`는 각 화의 본문 텍스트 + `model`/
  `keyIndex`(어떤 Gemini 모델·키가 썼는지, UI에 작게 표시) +
  `bookmarked?`.
- **`ArcSummary`** — 관찰 모드가 장편이 될 때(60화, 100화 이상)
  컨텍스트가 무한정 커지는 걸 막는 구간 요약. `lib/story.ts`의
  `nextArcRange()`가 순수 함수로 "다음에 압축할 구간"을 계산:
  `RECENT_FULL_COUNT=5`(전문 그대로 보내는 최근 화),
  `RECAP_LIMIT=50`(한 줄 요약으로 보내는 화 수),
  `ARC_CHUNK_SIZE=20`(구간 요약 하나가 묶는 화 수). 실제 압축은
  `app/api/summarize-arc/route.ts`가 Gemini Lite 모델로 수행하고,
  `app/observe/page.tsx`의 `handleContinue()`가 이어쓰기 직전에
  best-effort로 호출함(실패해도 다음 화 생성은 막지 않음).
- **`Universe`** — ORG(오리지널, 고정 id) + AU(사용자가 만드는
  대체 세계관). AU는 `worldSetting` 등의 텍스트에 `{{A}}`/`{{B}}`/
  `{{C}}` 토큰을 쓸 수 있고, `roleA`/`roleB`/`roleC`로 실제 캐릭터
  id를 배정. `lib/template.ts`의 `resolveUniverseTemplate()`이
  토큰을 실제 이름으로 치환(토큰 기반 — 실제 쓰인 토큰만 검사).
  `hasUnresolvedRoles()`로 미배정 상태를 감지해 UI에 경고 배지 표시.
  `relations[]`는 고정 10칸이지만, `UniverseForm`은 역할쌍(A-B, A-C,
  B-C)이 배정된 만큼만 스마트하게 라벨을 붙여 보여줌(데이터 구조는
  안 바꾸고 UI 레이어만 똑똑하게).
- **`CharacterMemory`** — 1:1 대화가 쌓일수록 하루 단위 기억이
  14일 지나면 주 단위로, 8주 지나면 달 단위로 압축(`lib/memory.ts`의
  `WEEK_COMPACT_AFTER_DAYS`/`MONTH_COMPACT_AFTER_WEEKS`). 관찰 모드의
  구간 요약과 철학은 같음(전부 버리지 않고 압축해서 계속 남김).

## Gemini 연동 (`lib/gemini.ts`)

- **다중 키**: `GEMINI_API_KEY` 환경변수를 쉼표로 여러 개 이어붙이면
  (`키1,키2,키3`) 서로 다른 구글 계정 키를 순서대로 시도. 현재
  사용자는 키 3개를 씀(설정 화면의 사용량 카드에 "키 1/2/3"로 표시).
- **모델 체인**: 대사 생성은 `DIALOGUE_MODELS = ["gemini-3.6-flash",
  "gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.5-flash"]`를
  우선 시도하고, 전부 소진되면 `LITE_MODEL = "gemini-3.5-flash-lite"`로
  내려감. **"-latest" 별칭은 절대 쓰지 않음** — 별칭이 가리키는 실제
  모델이 바뀌면서 RPD가 갑자기 확 줄어든 사고가 있었음.
- **`generate()`의 재시도 예산 버그(수정됨)**: `overallDeadlineMs`
  검사가 예전엔 "이미 지난 시간"만 봐서, 새로 시작하는 시도가 자기
  `timeoutMs`를 다 채우면 route의 `maxDuration`을 플랫폼이 먼저
  끊어버려 클라이언트에 원인불명의 "네트워크 문제"로 보이는 버그가
  있었음. 지금은 "이번 시도가 최악의 경우 다 걸려도 남은 예산 안에
  들어오는지"로 검사하도록 고쳐짐. `generateStoryEpisode`(관찰 모드
  화 생성)만 `overallDeadlineMs`/`retryOnTimeout`을 씀 — 시스템
  프롬프트가 커서(AU는 특히) 첫 시도 자체가 오래 걸리는 경우가 흔함.
- **사용량 추적** (`lib/db.ts`의 `recordApiUsage`/`getApiUsage`):
  구글은 API 키 기준으로 남은 할당량을 조회할 방법을 안 줘서, 앱이
  스스로 모든 호출의 성공/quota-초과 결과를 Redis 해시(`cc:usage:
  {date}`, `HINCRBY`, 14일 TTL)에 집계. **집계 기준일은 KST가 아니라
  태평양(America/Los_Angeles) 자정**(`lib/memory.ts`의
  `todayPacific()`) — 구글 Gemini API의 RPD 한도가 실제로 태평양
  자정에 리셋되기 때문(서머타임에 따라 한국 시간 오후 4~5시경). 설정
  화면(`/settings`)에 키·모델별 성공/한도초과 횟수를 보여줌.

## 디자인 시스템 (`app/globals.css`)

- **라이트/다크 둘 다 있음** (`prefers-color-scheme`로 시스템 설정
  자동 반영, 수동 토글 없음 — 세션 후반에 결정 뒤집힘: 처음엔 "하나로
  통일"했다가 나중에 "더 과감하게 바꾸자"며 라이트/다크로 다시 나눔).
  - 라이트 = "대담한 웜톤": 아이보리 바탕(`#faf6f0`) + 짙은 버건디
    액션 색(`#a8283f`).
  - 다크 = "웜 더스크": 순수 검정이 아니라 따뜻한 다갈색
    (`#1c1712`) + 앰버 포인트(`#e8783f`). "램프 밑에서 책 읽는 느낌"을
    노림 — 일반적인 차갑고 기술적인 다크모드와 의도적으로 구분.
  - 모든 색이 CSS 커스텀 프로퍼티(`--background`, `--primary`,
    `--accent` 등)로 관리되고 컴포넌트 어디에도 하드코딩된 hex가
    없어서(직접 확인함), 테마 전환이 `globals.css` 한 파일 수정만으로
    앱 전체에 반영됨.
- **글래스 표면 규칙**: `.glass`/`.glass-strong`은 상단바·패널·목록
  카드처럼 "여백 있는 장식적" 표면에만 씀. **대화 말풍선
  (`DialogueBubble`)이나 입력창처럼 빽빽하게 읽고 쓰는 표면에는 절대
  안 씀** — 가독성 때문에 의도적으로 불투명(`bg-card`) 유지. 이 구분을
  절대 허물지 말 것.
- **카드 깊이감**: `.card-shadow`/`.glass`/`.glass-strong`에 인셋
  하이라이트(`--surface-highlight` 변수, 테마별로 다른 값)를 얹어서
  마크업을 겹겹이 쌓는 "더블 베젤" 없이 유리판이 얇은 틀에 낀 듯한
  느낌을 흉내냄.
- **아이콘**: `components/icons.tsx`에 이모지를 대체하는 얇은 선
  아이콘 ~25종(`currentColor` 기반, `viewBox="0 0 20 20"`, 1em 크기).
  앱 전체 이모지(🗑⭐📑✎☰🎭 등)를 이걸로 교체 완료. **새 아이콘이
  필요하면 이 파일의 기존 스타일(스트로크 1.6, 둥근 캡/조인)을 따라
  추가할 것.**
- **모션**: `--default-transition-timing-function`을 Tailwind 기본
  ease 대신 스프링 계열(`cubic-bezier(0.16, 1, 0.3, 1)`)로 전역
  덮어씀(`:root`가 unlayered라 Tailwind의 `@layer theme` 값보다
  캐스케이드 우선순위가 높다는 점 이용). 주요 버튼엔
  `hover:scale-[1.02~1.03] active:scale-[0.97~0.98]` 패턴 적용.
- **참고했던 외부 스킬**: `uxjoseph/supanova-design-skill`(독립 랜딩
  페이지용 디자인 스킬)을 검토해서, 실제 앱 UI에 맞는 부분만 골라
  적용함(아이콘 통일, 카드 깊이감, 버튼 인터랙션, 팔레트 대담화).
  히어로 섹션·테스티모니얼·Bento 그리드 같은 랜딩페이지 전용 패턴은
  적용 안 함.
- **배경 이미지**: 사용자가 전역 배경 이미지를 업로드할 수 있음
  (`components/AppBackground.tsx`, `AppSettings.backgroundImage`,
  `/settings`). 유리 표면 틈으로 비쳐 보이는 게 핵심.

## 아직 확정 안 됐거나 지켜봐야 할 것

- **말투 프롬프트 완화가 실제로 효과 있었는지 미확인**: 관찰 모드의
  `[문체]` 지시가 한때 "예시 문장을 최대한 그대로 재현"하라고 너무
  강하게 써서, 상황에 안 맞아도 캐릭터 말투 예시를 그대로 복사해
  쓰는 부작용이 있었음. "패턴만 참고해 매번 새 대사를 쓴다"는 식으로
  완화했는데, 사용자가 실제 개선 여부를 아직 확인 안 함 — 다시
  불만이 나오면 더 강하게(또는 예전 방식으로 일부 되돌리는 걸) 고려.
- **AU 관계 필드의 참고 힌트(`referenceHint`)**: 캐릭터 프로필의
  `relatedCharacters`/`romance`에서 AU 상대 이름이 언급된 문장만
  필터링해서 보여줌 — 매칭 안 되면 힌트를 아예 안 보여줌(엉뚱한 내용
  보여주는 것보다 낫다는 판단). 이 필터링이 실제로 유용한 정보를
  놓치고 있는지는 사용성 피드백 필요.

## 이번 세션에서 다루지 않은 것

- 랜딩페이지(별도 소개 페이지) — 초안(Fraunces 세리프 + 아이보리
  글래스 무드보드)을 미리보기까지만 만들고, 사용자가 "이건 내가
  원한 게 아니다(실제 앱 UI를 바꿔달라는 거였다)"라며 방향을 바꿔
  실제 코드에는 반영 안 됨. 나중에 다시 요청이 오면 그 초안을
  참고해도 좋음(세션 히스토리에 전체 HTML 있음, 이 저장소엔 없음).
- 인증/로그인 시스템 — README에 명시된 대로 의도적으로 없음.
