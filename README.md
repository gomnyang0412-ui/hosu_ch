# 자작 캐릭터 챗봇 앱

내가 만든 캐릭터들과 1:1로 대화하거나, 여러 캐릭터가 등장하는 장면을 관찰하는 개인용 앱입니다.

- 1:1 대화: 캐릭터 한 명과 메신저처럼 대화
- 관찰 모드: 캐릭터 2명 이상이 등장하는 장면을 비주얼 노벨처럼 읽기

## 기술 스택

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Google Gemini API (`gemini-2.5-flash`)
- 데이터 저장: 브라우저 `localStorage` (로그인/DB 없음, `lib/storage.ts`에 모아둠)

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

이 저장소를 GitHub에 push하면 Vercel이 자동으로 빌드/배포합니다. 배포 전에 Vercel 프로젝트의 **Settings → Environment Variables**에서 `GEMINI_API_KEY`를 등록해야 합니다. (`NEXT_PUBLIC_` 접두사를 붙이지 않아야 브라우저에 노출되지 않습니다.)

## 폴더 구조

- `app/` — 화면과 API 라우트
  - `app/page.tsx` — 캐릭터 목록 (하단 탭 1)
  - `app/observe/page.tsx` — 관찰 모드 (하단 탭 2)
  - `app/world/page.tsx` — 세계관 설정
  - `app/character/new`, `app/character/[id]/edit` — 캐릭터 추가/편집
  - `app/character/[id]/chat` — 1:1 대화
  - `app/api/chat/route.ts` — 1:1 대화용 Gemini 호출 (서버 전용)
  - `app/api/scene/route.ts` — 관찰 모드 장면 생성용 Gemini 호출 (서버 전용)
- `lib/` — 데이터 모델, 저장 로직, 이미지 처리, Gemini 호출 로직
- `components/` — 공용 UI 컴포넌트

## API 키 관련 안내

Gemini API 키는 브라우저 코드에 절대 포함되지 않습니다. `app/api/chat`, `app/api/scene` 라우트 핸들러가 서버에서만 `process.env.GEMINI_API_KEY`를 읽어 Gemini를 호출하고, 브라우저는 이 두 라우트만 호출합니다.
