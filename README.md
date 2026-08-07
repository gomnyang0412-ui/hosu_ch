# 자작 캐릭터 챗봇 앱

내가 만든 캐릭터들과 1:1로 대화하거나, 여러 캐릭터가 등장하는 장면을 관찰하는 개인용 앱입니다.

- 1:1 대화: 캐릭터 한 명과 메신저처럼 대화
- 관찰 모드: 캐릭터 2명 이상이 등장하는 장면을 비주얼 노벨처럼 읽기
- AU(세계관): 오리지널 세계관(ORG) 외에 여러 개의 AU(다른 세계관)를 만들고, 같은 캐릭터를 AU 설정으로 대화/관찰할 수 있음 (대화 기록은 세계관별로 분리됨)

## 기술 스택

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Google Gemini API (`gemini-flash-latest` — Google이 관리하는 최신 Flash 모델 별칭. 특정 모델을 고정하지 않아 모델 만료로 인한 오류를 피한다)
- 데이터 저장: Vercel의 Upstash Redis 연동 (기기 간 동기화됨, `lib/db.ts` + `app/api/data/*`에 모아둠, 클라이언트는 `lib/storage.ts`로 접근)

## 로컬에서 실행하기

1. 의존성 설치

   ```bash
   npm install
   ```

2. `.env.example`을 복사해 `.env.local`을 만들고 Gemini API 키를 넣습니다. (`.env.local`은 `.gitignore`에 포함되어 있어 저장소에 올라가지 않습니다.)

   ```bash
   cp .env.example .env.local
   ```

   `.env.local` 안의 `GEMINI_API_KEY=` 뒤에 [Google AI Studio](https://aistudio.google.com/apikey)에서 발급받은 키를 붙여넣으세요.

3. 개발 서버 실행

   ```bash
   npm run dev
   ```

   [http://localhost:3000](http://localhost:3000)에서 확인합니다.

## Vercel 배포

이 저장소를 GitHub에 push하면 Vercel이 자동으로 빌드/배포합니다.

1. Vercel 프로젝트의 **Settings → Environment Variables**에서 `GEMINI_API_KEY`를 등록합니다. (`NEXT_PUBLIC_` 접두사를 붙이지 않아야 브라우저에 노출되지 않습니다.)
2. **Storage** 탭에서 Upstash Redis를 하나 만들어 이 프로젝트에 연결합니다. 연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경 변수가 자동으로 등록되어 별도 설정이 필요 없습니다.

데이터베이스가 아직 연결되지 않은 상태에서는 화면에 "서버에 데이터베이스가 연결되어 있지 않아요" 같은 안내가 표시됩니다.

### 로그인이 없다는 점 주의

이 앱은 개인용이라 로그인을 두지 않았습니다. 즉 배포된 주소를 아는 사람은 누구나 캐릭터를 보고 대화를 걸 수 있고, 그 과정에서 Gemini 사용량을 소모시킬 수도 있습니다. 주소를 남에게 공유하지 않는 것으로 우선 대비하고 있으며, 필요하면 간단한 비밀번호 잠금을 추가할 수 있습니다.

## 폴더 구조

- `app/` — 화면과 API 라우트
  - `app/page.tsx` — 캐릭터 목록 (하단 탭 1)
  - `app/au/page.tsx` — 세계관 목록: ORG + AU들 (하단 탭 2)
  - `app/au/new`, `app/au/[id]/edit` — AU 추가/편집 (ORG도 이 화면에서 편집)
  - `app/observe/page.tsx` — 관찰 모드 (하단 탭 3, `?universe=` 쿼리로 AU 지정 가능)
  - `app/character/new`, `app/character/[id]/edit` — 캐릭터 추가/편집
  - `app/character/[id]/chat` — 1:1 대화 (`?universe=` 쿼리로 AU 지정 가능)
  - `app/api/chat/route.ts` — 1:1 대화용 Gemini 호출 (서버 전용)
  - `app/api/scene/route.ts` — 관찰 모드 장면 생성용 Gemini 호출 (서버 전용)
  - `app/api/data/*` — 캐릭터/세계관(유니버스)/대화기록/관찰세션 CRUD (서버 전용, Redis 사용)
- `lib/db.ts` — Redis 읽기/쓰기 (서버 전용)
- `lib/storage.ts` — 브라우저에서 `app/api/data/*`를 호출하는 클라이언트
- `lib/migrate.ts` — 예전 버전(localStorage 저장 방식)의 데이터를 서버가 비어있을 때 한 번 옮기는 마이그레이션
- `lib/` — 그 외 데이터 모델, 이미지 처리, Gemini 호출 로직
- `components/` — 공용 UI 컴포넌트

## API 키 관련 안내

Gemini API 키는 브라우저 코드에 절대 포함되지 않습니다. `app/api/chat`, `app/api/scene` 라우트 핸들러가 서버에서만 `process.env.GEMINI_API_KEY`를 읽어 Gemini를 호출하고, 브라우저는 이 두 라우트만 호출합니다.

### 하루 사용량을 다 썼을 때 (여러 계정 키 함께 쓰기)

`GEMINI_API_KEY`에 쉼표(,)로 여러 키를 이어붙이면(`키1,키2,키3`), 서로 다른 구글 계정에서 발급받은 키를 순서대로 시도합니다. 앞 키의 하루 사용량이 다 떨어지면(429 오류) 자동으로 다음 키로 넘어가요. 대화 기록은 브라우저에 저장되고 어떤 키를 쓰는지와 무관하게 매번 함께 전송되므로, 키가 바뀌어도 대화 맥락은 그대로 이어집니다.
