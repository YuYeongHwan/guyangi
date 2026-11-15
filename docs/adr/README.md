# Architecture Decision Records

구양이의 아키텍처 결정 기록. 새 결정은 [template.md](template.md) 를 복사해 다음 번호로 쓰고 이 표에 추가한다.
바뀐 결정은 지우지 않고 상태를 `superseded by ADR-NNNN` 으로 바꾼다.

| ADR | 제목 | 상태 | 날짜 |
|-----|------|------|------|
| [0001](0001-supabase.md) | DB·인증·실시간을 Supabase 로 | accepted | 2026-11-15 |
| [0002](0002-python-matcher-분리.md) | 매칭 엔진을 Python 서비스로 분리 | accepted | 2026-11-15 |
| [0003](0003-cron-vs-queue.md) | 매처 실행은 cron 배치로 시작 (공개 저장소 정책 포함: 비밀 값 규칙, 예약 실행 지연·60일 비활성 중단 대응) | accepted | 2026-11-15 |
| [0004](0004-배송정보-보관정책.md) | 배송 정보는 매칭 단위로만 보관하고 30일 후 삭제 | accepted | 2026-11-15 |
| [0005](0005-알림-전달.md) | 알림은 Edge Function 이 웹 푸시와 이메일로 보낸다 | accepted | 2026-11-15 |
| [0006](0006-nextjs-16.md) | Next.js 16 과 Node 26 으로 시작 | accepted | 2026-11-15 |
