<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# hiátus — 프로젝트 핸드오프 문서

이 문서는 이 저장소를 처음 열어보는 AI 에이전트(Codex 등)를 위한 것이다.
아래는 다른 AI(Claude)와의 대화를 통해 이 앱을 설계·구현하면서 쌓인 맥락을
정리한 것이다. 코드를 고치기 전에 먼저 읽어라.

## 이 앱은 무엇인가

**hiátus**는 내가 만든 캐릭터들과 1:1로 대화하거나, 여러 캐릭터가 등장하는
장면/단편소설을 AI가 이어 쓰게 하는 **개인용** 한국어 롤플레이 챗봇이다.
로그인이 없다(의도적 설계 — 개인용이라 배포 주소만 알면 누구나 접근 가능).

- **Next.js 16.3.0 (App Router) + TypeScript + Tailwind v4**, Vercel 배포
- **Upstash Redis**가 유일한 영구 저장소 (`lib/db.ts`, 서버 전용)
- **Google Gemini API** (`@google/genai`)가 유일한 AI 백엔드 — 다른 제공사(OpenAI/Claude/Grok 등)는 안 쓴다
- 사용자(나)와 개발자(Claude/이제는 이 문서를 읽는 너)가 세션 여러 번에 걸쳐
  대화하면서 기능을 하나씩 얹어온 프로젝트다. 커밋 로그와 코드 주석에 "왜
  이렇게 짰는지"가 한국어로 꽤 자세히 남아 있다 — 지우지 말고 참고할 것.

## 핵심 개념 3가지

### 1. Room / RoomItem — 1:1 채팅과 멀티 대화방은 같은 데이터 모델이다
`lib/types.ts`의 `Room`(kind: "single" | "group")과 `RoomItem`(지문 n / 대사 d /
사용자 발화 u / 상황전환 x)이 1:1 채팅과 멀티 대화방을 완전히 통합한 모델이다.
예전엔 `ChatMessage`/`MultiThread`/`ThreadItem`이라는 별도 타입이 있었는데
(지금도 `lib/types.ts`에 `@deprecated`로 남아 있음 — 예전 백업 파일 복원·
마이그레이션 코드에서만 쓰인다), 이미 완전히 Room으로 통합됐다. **새 코드에서
ChatMessage/MultiThread를 새로 쓰지 마라.**
`app/api/room-chat/route.ts` 하나가 1:1과 멀티 대화방의 AI 호출을 전부 처리한다.

### 2. ORG / AU 유니버스 — 같은 캐릭터, 다른 세계관
캐릭터(성격·말투·외형 등)는 유니버스와 무관하게 하나만 존재한다.
`Universe`(ORG 하나 + AU 여러 개)가 "이 캐릭터들이 어떤 세계관·관계 설정
안에 있는지"를 따로 정의하고, 대화/관찰 시작 시 `lib/template.ts`가
`{{A}}`/`{{B}}`/`{{C}}` 같은 플레이스홀더를 실제 캐릭터 이름으로 치환한다.

**중요한 설계 원칙**: AU에서는 캐릭터 설정 중 **성격·말투만** 프롬프트에
들어가야 한다(`lib/gemini.ts`의 `characterLines(character, isAU)` 참고).
배경 이야기·연관 인물·애정 관계 같은 "원작 서사" 필드는 AU에서는 의도적으로
뺀다 — AU는 다른 세계관이니 원작 서사가 섞이면 안 된다는 게 사용자의 명확한
요구사항이었다. 캐릭터 기억(`CharacterMemory`, 아래 3번)도 같은 이유로
**유니버스별로 완전히 분리**돼 있다. 이 경계를 깨는 변경(예: AU 프롬프트에
원작 전용 필드를 다시 넣는 것)은 하기 전에 반드시 왜 필요한지부터 생각할 것.

### 3. CharacterMemory — 캐릭터별 장기 기억, 유니버스별로 분리
대화가 쌓이면 `lib/memoryService.ts`의 `syncCharacterMemory()`가 백그라운드로
(하루 단위 → 오래되면 주 단위 → 더 오래되면 달 단위로 압축) 요약해서
`CharacterMemory`에 쌓고, `lib/memory.ts`의 `buildMemoryBlock()`이 이걸
시스템 프롬프트에 "[기억]" 블록으로 주입한다. Redis 키는
`cc:memory:{characterId}:{universeId}`로 유니버스별로 분리돼 있다(과거엔
`cc:memory:{characterId}` 전역 키 하나였다 — ORG는 이 전역 키 내용을 처음
조회할 때 그대로 이어받고, 새 AU들은 빈 기억으로 시작한다. 자세한 이유는
바로 아래 "의도적으로 받아들인 트레이드오프" 참고).

## 폴더 구조

- `app/` — 화면(App Router 페이지) + `app/api/*`(서버 라우트)
  - `app/character/[id]/chat` — 1:1 대화, `app/thread/[threadId]` — 멀티 대화방
  - `app/au/*` — 유니버스(ORG/AU) 목록·생성·편집
  - `app/observe` — 관찰 모드(단편소설 이어쓰기)
  - `app/chats` — 카톡식 통합 대화 목록
  - `app/settings` — 배경 이미지, Gemini 사용량 통계
  - `app/api/room-chat` — 1:1/멀티 공용 AI 호출
  - `app/api/scene` — 관찰 모드 화 생성
  - `app/api/summarize*`, `app/api/character-profile`, `app/api/memory/sync` — 요약/기억/프로필 제안 관련 AI 호출
  - `app/api/data/*` — Redis CRUD (서버 전용, 클라이언트는 절대 직접 안 부르고 `lib/storage.ts`를 거친다)
- `lib/db.ts` — Redis 읽기/쓰기 전부 (서버 전용, "use client" 파일에서 import 금지)
- `lib/storage.ts` — 브라우저에서 `app/api/data/*`를 호출하는 fetch 클라이언트
- `lib/gemini.ts` — Gemini 호출 전부가 거쳐가는 `generate()` 공용 함수 + 용도별 래퍼(`generateChatReply`, `generateStoryEpisode` 등)
- `lib/memory.ts`(순수 유틸) / `lib/memoryService.ts`(Redis+Gemini 호출, 서버 전용) — 캐릭터 기억
- `lib/story.ts` — 관찰 모드 컨텍스트 윈도우 상수(최근 몇 화 전문을 다시 보낼지 등)
- `lib/types.ts` — 전체 데이터 타입의 원천. 새 필드 추가 시 여기부터
- `lib/migrate.ts` — 예전 localStorage 시절 데이터를 서버가 비어있을 때 1회 옮기는 마이그레이션
- `components/`, `components/chat/` — 공용 UI. `hooks/`에 화면 간 공유 로직(스크롤 보정, 백업 패널 등)

## 데이터 안전 원칙 (반드시 지킬 것)

이 프로젝트는 개인이 실제로 계속 쓰는 유일한 인스턴스라 **데이터 유실이
최우선 금지 사항**이다. 지금까지 지켜온 규칙:

1. **Redis 키를 스키마 변경 때문에 새로 팔 때, 예전 키는 절대 지우지 않는다.**
   대신 "처음 조회할 때 예전 키에서 새 키로 지연·멱등 마이그레이션"하는
   패턴을 계속 재사용한다(`getRooms()`, `getStories()`, `getCharacterMemory()`가
   전부 이 패턴이다 — 새 컬렉션을 추가할 때도 이 패턴을 따를 것).
2. **덮어쓰는 저장(save)들은 직전 값을 백업 이력에 남긴다** — `lib/db.ts`의
   `pushBackup`/`listBackups` (최근 5개 보관). `saveRoom`, `saveCharacters`,
   `saveUniverse`, `saveStory`, `saveCharacterMemory`, `saveAppSettings`,
   `deleteRoom`, `deleteUniverse`, `deleteStory`가 전부 적용돼 있다.
   **다만 이 백업을 사용자가 직접 복원하는 화면(UI)은 아직 없다** — 방(Room)
   백업만 `listRoomBackups`/`restoreRoomBackup` 함수가 있는데 이것도 어느
   화면에서도 호출되지 않는다. "백업 인프라는 있는데 복원 화면은 없다"가
   지금 상태다.
3. **스키마·마이그레이션급 변경은 실행 전에 반드시 사용자 승인**을 받는다
   (왜 필요한지 / 원인 / 기대 효과 / 데이터 유실 가능성 / 안전한 마이그레이션
   방법 / 대안 — 이 6개를 먼저 설명하고 승인받은 뒤에만 코드를 건드린다).
   임의로 "정리하다 보니" 스키마를 바꾸지 말 것.
4. 커밋은 작게, 관련 없는 리팩터링을 한 커밋에 묶지 않는다. 매 변경 후
   `npx tsc --noEmit` → `npx eslint <파일>` → `rm -rf .next && npm run build`
   → `npm run dev`로 뜨는 몇 개 핵심 페이지 curl/브라우저 확인까지 거친 뒤
   커밋한다. `git add -A`/`.` 금지, 건드린 파일만 명시적으로 add.
5. `git push --force`, `git reset --hard` 같은 파괴적 명령은 사용자가 명시적으로
   요청하지 않는 한 쓰지 않는다.

## Gemini 연동 — 알아야 할 패턴

- **다중 API 키 로테이션**: `GEMINI_API_KEY` 환경변수에 쉼표로 여러 개(서로
  다른 구글 계정)를 이어붙일 수 있다. 한 키의 하루 무료 한도(quota)가
  떨어지면 자동으로 다음 키로, 그것도 다 떨어지면 다음 모델로 내려간다
  (`DIALOGUE_MODEL_CHAIN` = gemini-3.6-flash → gemini-2.5-flash →
  gemini-3-flash-preview → gemini-3.5-flash → gemini-3.5-flash-lite).
  이 앱은 **유료 결제 없이 무료 티어만으로 굴러가는 걸 전제로 설계**돼 있다.
- **모든 Gemini 호출은 `lib/gemini.ts`의 `generate()`를 거친다.** 이 함수가
  키 로테이션, 모델 폴백, 개별 타임아웃(`timeoutMs`), 전체 재시도 예산
  (`overallDeadlineMs`)을 전부 관리한다. 새 기능에서 Gemini를 직접 부르지
  말고 반드시 `generate()`를 감싸는 새 래퍼 함수를 추가하는 식으로 확장할 것.
- **`overallDeadlineMs`는 반드시 `timeoutMs`의 2배보다 충분히 크게 잡을 것**
  — 이 프로젝트에서 같은 클래스의 버그가 최소 두 번 발생했다: `overallDeadlineMs`를
  "`timeoutMs` 정확히 2배"로 잡으면 첫 시도가 온전히 시간을 다 쓸 때 아주
  작은 오버헤드만 더해져도 재시도를 아예 시작도 못 해보고 실패한다. 새로
  Gemini 호출을 추가할 때 이 값을 어떻게 잡을지 `generateStoryEpisode` 주석을
  꼭 참고할 것.
- **`app/api/*` 라우트의 `maxDuration`은 그 라우트가 쓰는 `overallDeadlineMs`보다
  여유 있게 커야 한다** — 안 그러면 우리 코드가 깔끔한 에러 메시지를 만들기도
  전에 호스팅 플랫폼이 먼저 함수를 강제 종료해서, 사용자에겐 원인 불명의
  네트워크 에러로만 보인다.

## 의도적으로 받아들인 트레이드오프 / "알려진 이슈"

아래는 "버그인데 못 고친 것"이 아니라, **기능을 완성하기 위해 사용자와
합의하고 의도적으로 받아들인 제약**이다. 이 목록에 있는 걸 "발견"해서
무작정 고치려 들지 말고, 고치기 전에 반드시 왜 이렇게 됐는지 먼저 이해할 것.

1. **AU 유니버스는 캐릭터 기억이 빈 상태로 시작한다.** 유니버스별 기억
   분리(위 "핵심 개념 3") 작업 당시, 과거에 이미 쌓여있던 전역 기억을
   ORG/AU별로 사후에 정확히 재분류할 방법이 없었다(어느 기억이 어느
   유니버스에서 나온 건지 태그가 없었음). 그래서 "과거 전체 기억은 ORG의
   연속으로 간주하고, 모든 AU는 새로 시작"하는 쪽을 사용자가 직접 선택했다.
   원본 데이터 자체는 안 지웠다(예전 전역 키 `cc:memory:{characterId}`가
   여전히 존재) — 다만 AU 화면에는 그 과거 기억이 안 보인다.
2. **Redis에 트랜잭션이 없다.** 캐릭터/유니버스/방/이야기 전부 "하나의 JSON
   배열을 통째로 읽고 고치고 다시 쓰는" 구조라, 이론상 동시에 두 요청이
   겹치면 한쪽 저장이 사라질 수 있다(락도 없고 낙관적 동시성 제어도 없음).
   이건 진단됐지만 **아직 안 고쳤다** — 사용자가 "고위험, 별도 승인 필요"로
   분류해서 뒤로 미뤄뒀다. 개인용 앱이라 실제로 동시 요청이 겹칠 일이 거의
   없어서 우선순위가 낮다.
3. **`lib/migrate.ts`의 예전 localStorage→서버 마이그레이션이 중간에
   실패하면 이어서 재시도가 안 된다.** 이것도 위와 같은 이유로 진단만 되고
   아직 미수정 상태다(고위험 분류, 승인 대기).
4. **사진 첨부 기능은 만들었다가 완전히 제거했다.** `UserItem.image` 필드,
   2일 자동 만료 로직, Gemini에 이미지 전달하는 코드 전부 있었는데 "쓸모
   없다"는 판단으로 지웠다. **과거에 이미 사진을 보낸 대화 기록에는 여전히
   base64 이미지 데이터가 Redis에 남아있을 수 있다** — 지금 어떤 코드도
   그 필드를 안 읽지만, 지우지도 않았다. 이 데이터를 다시 쓰려 하지 말 것
   (관련 UI·타입이 전부 삭제됐다).
5. **`getApiUsage`는 호출 횟수만 세지, 토큰 수를 안 센다.** 실제 비용
   계산이 필요하면 이 통계로는 부족하다 — 토큰 단위 로깅은 아직 없다.
6. **관찰 모드 한 화 분량과 최근 전문 재전송 개수는 "속도 대 서사 밀도"
   트레이드오프로 튜닝된 값이다** (`RECENT_FULL_COUNT=3`, 한 화
   2200~2600자). AU 관찰모드에서 응답이 너무 오래 걸려 자주 실패하는
   문제 때문에 원래보다 줄인 값이다 — "왜 이렇게 짧아" 싶어도 임의로
   늘리지 말고, 늘릴 거면 다시 타임아웃 문제가 재발할 수 있다는 걸
   사용자에게 먼저 알릴 것.
7. **캐릭터 삭제 시, 그 캐릭터가 어떤 그룹 대화방의 `playerCharacterId`
   ("나는 이 중 한 명이다")였다면 그 방에서 자동으로 안 빠진다.** 의도적으로
   기존 동작을 보존한 것이다(Room/RoomItem 통합 때 "고치지 않고 그대로
   유지"하기로 결정됨).
8. **Gemini 응답 자체가 확률적으로 느리거나 실패할 수 있다는 건 근본적
   한계다.** 재시도 예산을 넉넉히 주는 식으로 완화는 계속해왔지만
   ("AI 응답이 너무 오래 걸려서 중단했어요" 메시지가 아예 0%가 되는 걸
   목표로 삼지 말 것 — Gemini 쪽 응답 시간 변동성은 이 코드베이스가
   통제할 수 있는 영역 밖이다), 완전히 없앨 수는 없다.

## 아직 사용자 승인을 기다리는 작업

- Redis 트랜잭션 부재로 인한 동시 저장 유실 (스키마 레벨 수정 필요, 고위험)
- `migrateFromLocalStorageIfNeeded` 부분 재시도 버그 수정 (고위험)

위 두 개는 진단은 끝났지만 **사용자가 아직 "진행해줘"라고 말한 적이 없다.**
먼저 시작하지 말고, 필요하다고 판단되면 왜 필요한지 설명부터 하고 승인을
받을 것 — 이 프로젝트 전체에 걸쳐 사용자가 반복적으로 요구해 온 작업 방식이다.
