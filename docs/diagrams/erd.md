# ERD

컬럼과 제약의 설명은 [../architecture.md](../architecture.md) 3장 참고. 사용자 id 만 uuid, 나머지 PK 는 bigint identity.

```mermaid
erDiagram
  profiles ||--|| user_stats : "평판"
  profiles ||--o| admins : "운영자"
  profiles ||--o{ set_requests : "요청"
  profiles ||--o{ collection_sets : "도감에 추가"
  profiles ||--o{ collection_entries : "보유"
  profiles ||--o{ wants : "우선순위"
  profiles ||--o{ match_participants : "참여"
  profiles ||--o{ notifications : "받음"
  profiles ||--o{ push_subscriptions : "기기별 구독"
  profiles ||--|| notification_settings : "알림 설정"
  match_legs ||--o{ reports : "미수령 신고"

  series ||--o{ sets : "포함"
  sets ||--o{ items : "구성"
  sets ||--o{ collection_sets : ""
  items ||--o{ collection_entries : ""
  items ||--o{ wants : ""
  items ||--o{ match_legs : "교환 대상"

  matches ||--|{ match_participants : "2~3명"
  matches ||--|{ match_legs : "한 줄 = 아이템 하나"
  matches ||--o{ shipping_addresses : "받는 사람별"
  matches ||--o{ reports : "신고"
  matches ||--o{ notifications : ""

  profiles {
    uuid id PK
    text nickname UK
    timestamptz age_confirmed_at
    timestamptz terms_agreed_at
    text terms_version
    timestamptz privacy_agreed_at
    text privacy_version
  }
  user_stats {
    uuid user_id PK
    int completed_count
    int confirmed_report_count
    int no_response_count
    timestamptz priority_since
    timestamptz suspended_at
  }
  admins {
    uuid user_id PK
  }
  series {
    bigint id PK
    text name UK
    text slug UK
  }
  sets {
    bigint id PK
    bigint series_id FK
    text name
    text kind
    date released_on
    boolean is_published
    text image_path
    text cell_ratio
  }
  items {
    bigint id PK
    bigint set_id FK
    text name
    int sort_order
    text image_path
  }
  set_requests {
    bigint id PK
    uuid user_id FK
    text title
    text status
  }
  collection_sets {
    uuid user_id PK
    bigint set_id PK
    boolean trade_enabled "교환 참여 스위치, 기본 꺼짐"
    text want_mode "all_missing, selected"
    timestamptz added_at
  }
  collection_entries {
    uuid user_id PK
    bigint item_id PK
    int owned_qty
    int keep_qty "null = 기본, 하나 소장"
    int reserved_qty
    boolean trade_enabled "이 칸을 내놓는지"
  }
  wants {
    uuid user_id PK
    bigint item_id PK
    smallint priority
  }
  matches {
    bigint id PK
    text kind
    text status
    timestamptz respond_by
    timestamptz confirmed_at
    timestamptz ship_by
    timestamptz warned_at
    timestamptz closed_at
    text cancel_reason
  }
  match_participants {
    bigint match_id PK
    uuid user_id PK
    text response
    timestamptz responded_at
  }
  match_legs {
    bigint id PK
    bigint match_id FK
    uuid from_user FK
    uuid to_user FK
    bigint item_id FK
    text carrier
    text tracking_no
    timestamptz shipped_at
    timestamptz received_at
    boolean auto_received
    timestamptz settled_at
    timestamptz released_at
  }
  push_subscriptions {
    bigint id PK
    uuid user_id FK
    text endpoint UK
    text p256dh
    text auth
  }
  notification_settings {
    uuid user_id PK
    text email
    timestamptz email_verified_at
    boolean email_enabled
    boolean push_enabled
  }
  shipping_addresses {
    bigint match_id PK
    uuid user_id PK
    text recipient_name
    text phone
    text postal_code
    text address1
    text address2
  }
  reports {
    bigint id PK
    bigint match_id FK
    bigint leg_id FK
    uuid reporter_id FK
    uuid reported_id FK
    bigint appeal_of FK
    text source
    text reason
    text status
  }
  notifications {
    bigint id PK
    uuid user_id FK
    bigint match_id FK
    text type
    jsonb payload
    boolean needs_email
    timestamptz push_sent_at
    timestamptz email_sent_at
    timestamptz read_at
  }
  app_settings {
    text key PK
    jsonb value
  }
  matcher_runs {
    bigint id PK
    timestamptz started_at
    timestamptz finished_at
    int proposed_pair
    int proposed_cycle3
  }
```

뷰 (테이블 아님): `tradable_haves`(양), `wanted_items`(구), `matchable_users`(매칭 가능 사용자와 cycle3 자격).
`match_legs.from_user`, `to_user`, `reports.reporter_id`, `reported_id` 는 모두 `profiles.id` 를 가리킨다.
