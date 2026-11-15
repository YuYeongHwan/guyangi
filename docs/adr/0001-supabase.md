# ADR-0001: DB·인증·실시간을 Supabase 로

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: 프로젝트 오너, Claude

## Context

구양이는 한 사람이 만들고 운영한다. 필요한 것은 관계형 데이터(세트·아이템·도감·매칭), 카카오·구글 로그인, 매칭 알림의 실시간 전달, 굿즈 이미지 저장이다. 수량과 예약은 여러 사용자와 매처가 동시에 건드리므로 트랜잭션과 제약이 필요하고, 배송 정보는 "내가 보낼 상대의 것만" 보이도록 행 단위 접근 제어가 필요하다.

## Decision

DB, 인증, 실시간, 파일 저장을 Supabase 하나로 쓴다. 접근 제어는 RLS 로, 수량·예약·상태 전이의 불변 조건은 Postgres 제약과 함수로 지킨다.

## Alternatives Considered

### 대안 1: Firebase (Firestore + Auth)
- **Pros**: 실시간과 인증이 쉽고 모바일 친화적이다.
- **Cons**: 문서 DB 라 "세 사람의 수량을 한 트랜잭션에서 옮긴다", "양 = 보유 − 소장 − 예약" 같은 관계형 계산과 제약을 앱 코드로 써야 한다. 카카오 로그인은 직접 붙여야 한다.
- **Why not**: 이 서비스의 핵심 위험이 수량 정합성인데, 그것을 DB 가 지켜 주지 않는다.

### 대안 2: 관리형 Postgres(Neon 등) + Auth.js + 직접 만든 API
- **Pros**: 벤더 종속이 작고 구성 요소를 자유롭게 고른다.
- **Cons**: 인증, 권한 검사 API, 실시간 전달, 파일 저장을 각각 만들고 운영해야 한다.
- **Why not**: 혼자 만드는 MVP 에서 만들 것이 너무 많아진다.

## Consequences

### Positive
- 카카오·구글 로그인, Realtime, Storage, pg_cron 을 추가 인프라 없이 쓴다.
- RLS 덕분에 웹이 service role 키 없이 DB 를 직접 부를 수 있어 API 계층이 얇아진다.
- 매처(Python)와 웹(TypeScript)이 같은 DB 함수와 뷰를 계약으로 공유한다.

### Negative
- 핵심 로직이 SQL 함수와 RLS 정책에 들어가서, 애플리케이션 코드보다 테스트와 리뷰가 어렵다.
- Supabase 고유 기능(Auth, Realtime, RLS 의 `auth.uid()`)에 묶인다.

### Risks
- **RLS 실수로 인한 정보 노출** → 타인의 도감·배송 정보 접근 차단을 필수 테스트로 둔다 (docs/testing.md). RLS·인증 변경 시 security-review.
- **무료 요금제 한도와 비활성 프로젝트 일시 정지** → 출시 전 요금제와 한도를 확인한다.
