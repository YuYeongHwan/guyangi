-- TASKS 2.1: 사용자 테이블. 설계는 docs/architecture.md 3.1, 3.5, 4장.
--
-- 권한은 두 겹이다.
--   1) 테이블·컬럼 권한: anon, authenticated 의 기본 권한을 전부 회수하고 필요한 것만 준다.
--   2) RLS: 어떤 행에 닿을 수 있는지.
-- Supabase 는 public 스키마의 새 테이블을 기본으로 노출하므로, 정책 실수 하나가 곧 노출이 되지 않게 한다.
-- 컬럼 권한을 쓰기 때문에 클라이언트는 select('*') 를 쓸 수 없다. 항상 컬럼을 명시한다 (CLAUDE.md).

-- ── 공용: updated_at 갱신 ────────────────────────────────────────────────
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ── profiles ─────────────────────────────────────────────────────────────
-- 프로필은 동의한 뒤에만 만들어진다 (architecture.md 2.0). insert 는 create_profile 함수(TASKS 2.6)만 한다.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- 2~12자, 한글(완성형)·영문·숫자·밑줄
  nickname text not null
    constraint profiles_nickname_format check (nickname ~ '^[가-힣A-Za-z0-9_]{2,12}$'),
  age_confirmed_at timestamptz not null,
  terms_agreed_at timestamptz not null,
  terms_version text not null,
  privacy_agreed_at timestamptz not null,
  privacy_version text not null,
  created_at timestamptz not null default now()
);
-- 중복 불가, 영문 대소문자를 구분하지 않고 비교한다
create unique index profiles_nickname_lower_key on public.profiles (lower(nickname));

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
-- 동의 시각 세 컬럼은 다른 사용자에게 보일 이유가 없어 열지 않는다. 버전은 재동의 판단에 본인이 읽는다.
grant select (id, nickname, created_at, terms_version, privacy_version)
  on table public.profiles to authenticated;
grant update (nickname) on table public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── user_stats ───────────────────────────────────────────────────────────
-- 최소 평판. 상태를 바꾸는 함수(security definer)만 쓴다.
create table public.user_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  completed_count integer not null default 0 check (completed_count >= 0),
  confirmed_report_count integer not null default 0 check (confirmed_report_count >= 0),
  no_response_count integer not null default 0 check (no_response_count >= 0),
  priority_since timestamptz,
  suspended_at timestamptz
);

alter table public.user_stats enable row level security;
revoke all on table public.user_stats from anon, authenticated;
-- 다른 사용자에게는 평판 횟수 3개만 연다. 정지·우선권 시각은 user_status() 로 본인과 운영자만 읽는다.
grant select (user_id, completed_count, confirmed_report_count, no_response_count)
  on table public.user_stats to authenticated;

create policy user_stats_select on public.user_stats
  for select to authenticated
  using (true);

-- ── admins, is_admin() ───────────────────────────────────────────────────
-- 클라이언트 접근 없음. 정책이 하나도 없고 권한도 없다. 운영자 지정은 DB 에서 직접 한다.
create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete cascade
);

alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_admin() from public;
-- 정책 안에서 방문자에게도 평가되므로 anon 도 실행할 수 있어야 한다 (방문자는 항상 false)
grant execute on function public.is_admin() to anon, authenticated;

-- 정지·재매칭 우선권 시각: 본인과 운영자만
create function public.user_status(p_user uuid)
returns table (user_id uuid, suspended_at timestamptz, priority_since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or (p_user is distinct from (select auth.uid()) and not public.is_admin()) then
    raise exception '본인과 운영자만 볼 수 있어요' using errcode = '42501';
  end if;
  return query
    select s.user_id, s.suspended_at, s.priority_since
    from public.user_stats s
    where s.user_id = p_user;
end;
$$;
revoke execute on function public.user_status(uuid) from public, anon;
grant execute on function public.user_status(uuid) to authenticated;

-- ── app_settings ─────────────────────────────────────────────────────────
-- 기한·기준 값. is_public 인 키만 로그인 사용자가 읽는다. 키 추가와 공개 여부는 마이그레이션으로만 바꾼다.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;
grant select on table public.app_settings to authenticated;
grant update (value) on table public.app_settings to authenticated;

create policy app_settings_select on public.app_settings
  for select to authenticated
  using (is_public or (select public.is_admin()));
create policy app_settings_update_admin on public.app_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 초기값 (architecture.md 3.5). 운영에도 필요한 값이라 seed.sql 이 아니라 마이그레이션에 둔다.
insert into public.app_settings (key, value, description, is_public) values
  ('terms_version', '"2026-11-draft"', '현재 이용약관 버전. 프로필의 버전과 다르면 다시 동의받는다', true),
  ('privacy_version', '"2026-11-draft"', '현재 개인정보 처리방침 버전', true),
  ('respond_hours', '24', '제안 응답 기한 (시간)', true),
  ('ship_warn_hours', '48', '발송 경고까지 (시간)', true),
  ('ship_dispute_hours', '72', '분쟁 전환까지 (시간)', true),
  ('auto_receive_days', '7', '발송 후 자동 수령 확인까지 (일)', true),
  ('shipping_retention_days', '30', '교환 종료 후 배송 정보 보관 (일)', true),
  ('cycle3_min_completed', '3', '3자 순환 참여에 필요한 최소 완료 횟수', true),
  ('cycle3_max_reports', '0', '3자 순환 참여를 허용하는 확인된 신고 횟수', false),
  ('suspend_report_count', '2', '신규 매칭이 정지되는 확인된 신고 횟수', false),
  ('repropose_cooldown_days', '7', '거절·만료된 같은 leg 조합을 다시 제안하지 않는 기간 (일)', false),
  ('cycle3_candidates_per_set_max', '5000', '세트당 3자 순환 후보 상한 (임시값, Sprint 4 실측 후 조정)', false);
