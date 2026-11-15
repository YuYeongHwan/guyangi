# 구양이 (guyangi)

## 개요
랜덤 굿즈(콜라보 카페 특전, 페어 특전, 쿠지, 랜덤 캔뱃지)를 위한
"내 굿즈 도감" + "1:1 / 3자 순환 교환 자동 매칭" 웹 서비스.
마스코트: 남는 굿즈를 물어다 주는 고양이 "구양이" 🐾
목표: 포트폴리오 + 실사용자 운영. 판매·결제 기능은 만들지 않는다 (교환만).

## 핵심 개념
- 세트(set): 랜덤 굿즈 묶음 (예: 프로세카×애니플러스 코스터 26종)
- 아이템(item): 세트의 한 종류
- 도감(collection_entries): 사용자별 아이템 보유 수량(owned_qty), 소장 개수(keep_qty)
- 양(讓): owned_qty - keep_qty - reserved_qty > 0 이고 trade_enabled 인 것 → tradable_haves 뷰
- 구(求): 도감에 추가한 세트에서 owned_qty = 0 인 아이템 (+ wants로 우선순위)
- 매칭(match): pair(1:1) 또는 cycle3(3자 순환). match_legs = 누가 누구에게 무엇을
- 매칭 제안 시 reserved_qty 증가 → 거절/만료 시 해제. 완료 시 owned_qty 이동(단일 트랜잭션)
- 교환 상태: proposed → confirmed → shipping → completed / cancelled / expired / disputed
  (전이 규칙은 docs/diagrams/exchange-state-machine.md, 전이는 DB 함수로만)
- match_legs 는 한 줄 = 아이템 하나. 같은 두 사용자 사이 leg 수에 제약을 두지 않는다
- 기한·기준 값(응답 24h, 발송 48h/72h, 보관 30일 등)은 app_settings 테이블에서 읽는다

## 스택
- apps/web: Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui, 모바일 우선 PWA
- DB/Auth: Supabase (Postgres, RLS 필수, Auth: kakao/google, Realtime, Storage)
- services/matcher: Python 3.12, uv, networkx, supabase-py, pytest
- 알림: 인앱(Realtime) + 웹 푸시(VAPID) + 이메일(Resend). 발송은 Supabase Edge Function
- 배포: Vercel(web), GitHub Actions cron 10분(matcher, 초기), pg_cron 5분(기한 처리)

## 저장소 구조
guyangi/
├ apps/web/            Next.js 사이트 + /admin
├ services/matcher/    Python 매칭 엔진
├ supabase/            migrations/, seed.sql
├ packages/shared/     supabase gen types 결과, 공용 타입
├ docs/                아래 "문서 구조" 참고
├ TASKS.md
└ CLAUDE.md

## 규칙
- 모든 테이블 RLS 활성화. 배송 정보는 확정된 match 에서 "내가 보낼 상대"의 것만 조회 가능
  (같은 매칭 참여자라도 내가 보내지 않는 사람의 배송 정보는 볼 수 없다)
- 배송 정보는 매칭 단위로만 저장하고 교환 종료 30일 후 자동 삭제. 이메일·푸시 본문에 넣지 않는다
- service role 키는 매처와 Supabase Edge Function 에만 둔다. 웹(Vercel)에는 두지 않는다
- 저장소는 공개다. 비밀 값은 커밋하지 않는다: 값이 빈 .env.example 만 두고, .env* 는 .gitignore,
  커밋 전 비밀 값 스캔. 시드·픽스처에 실제 개인정보 금지 (ADR-0003)
- cycle3 참여 조건: 교환 완료 3회 이상이고 미발송 신고 0회. 그 외에는 pair만
- 서버 액션/라우트 핸들러에서 zod로 입력 검증
- DB 변경은 반드시 supabase/migrations 에 마이그레이션 파일로
- 타입은 `supabase gen types` 결과를 packages/shared 에서 import
- 매칭 엔진 변경 시 pytest 통과 필수. 사이클에 같은 사용자 중복 금지 테스트 유지
- 매칭 선택은 1:1 먼저, 그다음 3자 순환. 같은 입력이면 같은 결과 (docs/matcher.md)
- docs/testing.md 3장의 필수 보장 테스트는 지우거나 건너뛰지 않는다. 테스트를 먼저 쓴다
- E2E 테스트 로그인 경로는 운영 빌드에서 제외한다 (*.e2e.ts + pageExtensions). 환경 변수 확인만으로 막지 않는다
- 커밋 전: `pnpm lint && pnpm typecheck && pnpm test`, matcher는 `uv run pytest`
- UI 문구는 친근한 고양이 톤 ("구양이가 물어왔어요 🐾"), 기준은 docs/DESIGN.md
- 기능 하나 = 브랜치 하나 = PR 하나. 큰 작업은 먼저 Plan 모드로 계획
- 결정이 바뀌면 이 파일과 관련 docs를 즉시 갱신

## 스킬 사용 규칙
작업 유형에 맞는 스킬을 먼저 로드하고 그 지침을 따른다.
스킬 이름이 정확히 일치하지 않으면 find-skills 로 가장 가까운 설치된 스킬을 찾아 쓴다.
진행 방식은 TASKS.md의 스프린트를 따른다. GSD 페이즈 워크플로는 쓰지 않는다
(예외: gsd-debug, gsd-quick).

| 작업 | 스킬 |
|---|---|
| 기획·PRD | ecc:plan-prd → docs/specs/PRD.md |
| 설계 결정 | ecc:architecture-decision-records → docs/adr/NNNN-제목.md |
| 전체 설계도 | ecc:blueprint |
| API·서버 액션 설계 | ecc:api-design |
| DB 스키마·RLS·쿼리 | ecc:postgres-patterns |
| 마이그레이션 | ecc:database-migrations |
| 테스트 (기본 TDD) | ecc:tdd-workflow |
| 매칭 엔진 테스트 | ecc:tdd-workflow + ecc:python-testing |
| E2E | ecc:e2e-testing |
| UI 구현 | anthropic-skills:impeccable 우선, anthropic-skills:frontend-design 보조 |
| Next.js·React 패턴 | ecc:nextjs-turbopack, ecc:react-patterns, ecc:frontend-patterns |
| 랜딩 페이지 | design-taste-frontend |
| UI 문구 | impeccable + docs/DESIGN.md 고양이 톤 가이드 |
| 접근성 | ecc:accessibility, ecc:frontend-a11y |
| 관리자 차트 | dataviz |
| 코드 리뷰 | code-review, 프론트 ecc:react-review, 매처 ecc:python-review |
| 보안 리뷰 | security-review (RLS·인증·배송정보 변경 시 필수) |
| 디버깅 | gsd-debug |
| 작은 수정 | gsd-quick |
| 문서 갱신 | ecc:update-docs |
| 출시 | ecc:deployment-patterns, ecc:production-audit |
| 화면 확인 | run, agent-browser |
| 다이어그램 | Mermaid로 docs/diagrams/ 에 저장 |

## 문서 구조
docs/
├ specs/PRD.md     제품 요구사항
├ architecture.md  구성 요소 경계, 데이터 흐름, DB 스키마, RLS 개요
├ adr/             아키텍처 결정 기록
├ DESIGN.md        디자인 시스템 + 고양이 톤 문구 가이드
├ diagrams/        ERD, 교환 상태머신 (Mermaid)
├ testing.md       테스트 전략
└ matcher.md       매칭 알고리즘 설명
TASKS.md           스프린트 작업 목록 (체크리스트)

## 명령어
- pnpm dev / pnpm build / pnpm lint / pnpm typecheck / pnpm test
- supabase start / supabase db reset / supabase gen types typescript --local
- cd services/matcher && uv run pytest && uv run python -m matcher.run