-- TASKS 2.3: 도감과 교환 참여 기본값. 설계는 docs/architecture.md 3.3, 4장.
-- 도감에 기록하는 것과 교환에 내놓는 것은 다른 일이다.
-- 기록만 한 사용자(세트 스위치 꺼짐)의 아이템은 양(tradable_haves)에도 구(wanted_items)에도 없다.
--
-- 권한은 2.1, 2.2 와 같은 두 겹이다: 기본 권한을 전부 회수한 뒤 필요한 컬럼만 주고, RLS 로 본인 행만 연다.
-- 방문자(anon)에게는 아무 권한도 주지 않는다.
-- insert 정책은 호출자가 읽을 수 있는 세트·아이템인지도 확인한다. 정책 검사가 FK 검사보다 먼저라서
-- 비공개 세트의 id 를 넣어 보고 FK 오류(23503) 여부로 존재를 알아내는 길이 막힌다.

-- ── collection_sets: 도감에 추가한 세트 + 교환 참여 스위치 ───────────────
create table public.collection_sets (
  user_id uuid not null references public.profiles (id) on delete cascade,
  set_id bigint not null references public.sets (id),
  -- 세트의 교환 참여 스위치. 꺼져 있으면 이 세트의 아이템은 양에도 구에도 없다
  trade_enabled boolean not null default false,
  -- 구의 범위: all_missing = 빈칸 전부, selected = wants 에 고른 것만
  want_mode text not null default 'all_missing'
    constraint collection_sets_want_mode_check check (want_mode in ('all_missing', 'selected')),
  added_at timestamptz not null default now(),
  primary key (user_id, set_id)
);
-- 뷰가 교환 참여 중인 세트만 읽는다 (architecture.md 3.6)
create index collection_sets_set_id_trading_idx on public.collection_sets (set_id) where trade_enabled;

alter table public.collection_sets enable row level security;
revoke all on table public.collection_sets from anon, authenticated;
grant select, delete on table public.collection_sets to authenticated;
-- added_at 은 대기 시간의 기준이라 사용자가 쓸 수 없다 (기본값으로만 들어간다)
grant insert (user_id, set_id, trade_enabled, want_mode) on table public.collection_sets to authenticated;
grant update (trade_enabled, want_mode) on table public.collection_sets to authenticated;

create policy collection_sets_select_own on public.collection_sets
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy collection_sets_insert_own on public.collection_sets
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.sets s where s.id = collection_sets.set_id)
  );
create policy collection_sets_update_own on public.collection_sets
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy collection_sets_delete_own on public.collection_sets
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── collection_entries: 칸 하나 ──────────────────────────────────────────
create table public.collection_entries (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id bigint not null references public.items (id),
  owned_qty integer not null default 0,
  -- null = 기본(종류마다 하나 소장). 숫자면 이 칸만 바꾼 소장 개수
  keep_qty integer,
  -- false = "이 칸은 내놓지 않음" (양에만 작용한다)
  trade_enabled boolean not null default true,
  -- 매칭 제안이 잡아 둔 수량. 함수만 바꾼다 (Sprint 4 propose_match)
  reserved_qty integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id),
  constraint collection_entries_qty_nonnegative check (owned_qty >= 0 and reserved_qty >= 0),
  constraint collection_entries_keep_within_owned check (keep_qty is null or (keep_qty >= 0 and keep_qty <= owned_qty)),
  -- 실제 소장 = coalesce(keep_qty, least(owned_qty, 1)). 소장과 예약을 빼고 음수가 될 수 없다
  constraint collection_entries_reserved_within_spare
    check (owned_qty - coalesce(keep_qty, least(owned_qty, 1)) - reserved_qty >= 0)
);
-- 매처가 아이템 기준으로 양을 읽는다 (architecture.md 3.6)
create index collection_entries_item_id_trading_idx on public.collection_entries (item_id) where trade_enabled;

create trigger collection_entries_set_updated_at
  before update on public.collection_entries
  for each row execute function public.set_updated_at();

alter table public.collection_entries enable row level security;
revoke all on table public.collection_entries from anon, authenticated;
grant select, delete on table public.collection_entries to authenticated;
-- reserved_qty 와 updated_at 은 insert 로도 update 로도 쓸 수 없다
grant insert (user_id, item_id, owned_qty, keep_qty, trade_enabled) on table public.collection_entries to authenticated;
grant update (owned_qty, keep_qty, trade_enabled) on table public.collection_entries to authenticated;

create policy collection_entries_select_own on public.collection_entries
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy collection_entries_insert_own on public.collection_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i where i.id = collection_entries.item_id)
  );
create policy collection_entries_update_own on public.collection_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- 예약이 있는 칸은 지울 수 없다
create policy collection_entries_delete_own on public.collection_entries
  for delete to authenticated
  using (user_id = (select auth.uid()) and reserved_qty = 0);

-- ── wants: 구의 우선순위, selected 모드에서는 구할 아이템을 고르는 목록 ──
create table public.wants (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id bigint not null references public.items (id),
  priority smallint not null default 0,
  -- 고른 시각. selected 모드에서 대기 시간의 기준
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index wants_item_id_idx on public.wants (item_id);

alter table public.wants enable row level security;
revoke all on table public.wants from anon, authenticated;
grant select, delete on table public.wants to authenticated;
-- created_at 은 사용자가 쓸 수 없다 (기본값으로만 들어간다)
grant insert (user_id, item_id, priority) on table public.wants to authenticated;
grant update (priority) on table public.wants to authenticated;

create policy wants_select_own on public.wants
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy wants_insert_own on public.wants
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i where i.id = wants.item_id)
  );
create policy wants_update_own on public.wants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy wants_delete_own on public.wants
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── 뷰: 양과 구 ──────────────────────────────────────────────────────────
-- security_invoker: 사용자 세션은 바탕 테이블의 RLS 를 따라 자기 행만 읽고, 매처(service role)는 전체를 읽는다.
-- s.is_published 를 뷰에 직접 쓴다. service role 은 RLS 를 건너뛰므로 조건이 뷰에 있어야 두 경로의 결과가 같다.
-- 정지된 사용자는 여기서 거르지 않는다. 매처가 matchable_users 와 join 해서 거른다 (Sprint 4).

-- 양: 세트 스위치가 켜져 있고, 칸을 내놓았고, 실제 소장과 예약을 빼고 남는 것
create view public.tradable_haves
with (security_invoker = true) as
select e.user_id, e.item_id,
       e.owned_qty - coalesce(e.keep_qty, least(e.owned_qty, 1)) - e.reserved_qty as qty
from public.collection_entries e
join public.items i on i.id = e.item_id
join public.sets s on s.id = i.set_id and s.is_published
join public.collection_sets cs on cs.user_id = e.user_id and cs.set_id = i.set_id
where cs.trade_enabled
  and e.trade_enabled
  and e.owned_qty - coalesce(e.keep_qty, least(e.owned_qty, 1)) - e.reserved_qty > 0;

-- 구: 세트 스위치가 켜져 있고, 보유 0 이고, (빈칸 전부 구하기 이거나 wants 에 고른 것)
create view public.wanted_items
with (security_invoker = true) as
select cs.user_id, i.id as item_id, i.set_id,
       coalesce(w.priority, 0) as priority,
       -- 대기 시간 기준: 고른 것만 구하기는 고른 시각, 빈칸 전부 구하기는 칸 수정 시각(없으면 세트 추가 시각)
       case when cs.want_mode = 'selected' then w.created_at
            else coalesce(e.updated_at, cs.added_at) end as waiting_since
from public.collection_sets cs
join public.sets s on s.id = cs.set_id and s.is_published
join public.items i on i.set_id = cs.set_id
left join public.collection_entries e on e.user_id = cs.user_id and e.item_id = i.id
left join public.wants w on w.user_id = cs.user_id and w.item_id = i.id
where cs.trade_enabled
  and coalesce(e.owned_qty, 0) = 0
  and (cs.want_mode = 'all_missing' or w.item_id is not null);

revoke all on table public.tradable_haves, public.wanted_items from anon, authenticated;
grant select on table public.tradable_haves, public.wanted_items to authenticated;
