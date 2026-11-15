-- TASKS 2.2: 카탈로그 (장르 독립). 설계는 docs/architecture.md 3.2, 4장.
-- 읽기: 공개된 세트와 그 아이템은 누구나(방문자 포함), 비공개는 운영자만. 쓰기: 운영자만.
-- 삭제는 FK 가 막는다(restrict). 도감이 참조하는 세트·아이템은 지우지 않고 비공개로 돌린다.

-- ── series ───────────────────────────────────────────────────────────────
create table public.series (
  id bigint generated always as identity primary key,
  name text not null unique check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

alter table public.series enable row level security;
revoke all on table public.series from anon, authenticated;
grant select on table public.series to anon, authenticated;
grant insert, update, delete on table public.series to authenticated;

create policy series_select on public.series
  for select to anon, authenticated
  using (true);
create policy series_insert_admin on public.series
  for insert to authenticated
  with check ((select public.is_admin()));
create policy series_update_admin on public.series
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy series_delete_admin on public.series
  for delete to authenticated
  using ((select public.is_admin()));

-- ── sets ─────────────────────────────────────────────────────────────────
create table public.sets (
  id bigint generated always as identity primary key,
  series_id bigint not null references public.series (id),
  name text not null check (length(btrim(name)) > 0),
  kind text not null check (kind in ('collab_cafe', 'pair_bonus', 'kuji', 'can_badge', 'other')),
  released_on date,
  is_published boolean not null default false,
  image_path text,
  -- 도감 칸의 가로:세로 비율. 값의 뜻은 docs/DESIGN.md
  cell_ratio text not null default '1:1' check (cell_ratio in ('1:1', '3:4')),
  created_at timestamptz not null default now()
);
create index sets_series_id_idx on public.sets (series_id);

alter table public.sets enable row level security;
revoke all on table public.sets from anon, authenticated;
grant select on table public.sets to anon, authenticated;
grant insert, update, delete on table public.sets to authenticated;

create policy sets_select on public.sets
  for select to anon, authenticated
  using (is_published or (select public.is_admin()));
create policy sets_insert_admin on public.sets
  for insert to authenticated
  with check ((select public.is_admin()));
create policy sets_update_admin on public.sets
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy sets_delete_admin on public.sets
  for delete to authenticated
  using ((select public.is_admin()));

-- ── items ────────────────────────────────────────────────────────────────
create table public.items (
  id bigint generated always as identity primary key,
  set_id bigint not null references public.sets (id),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null check (sort_order >= 0),
  image_path text,
  -- (set_id, sort_order) 인덱스가 set_id FK 조회도 맡는다
  unique (set_id, sort_order)
);

alter table public.items enable row level security;
revoke all on table public.items from anon, authenticated;
grant select on table public.items to anon, authenticated;
grant insert, update, delete on table public.items to authenticated;

-- 속한 세트가 내게 보이면 아이템도 보인다. 세트의 RLS(공개 또는 운영자)가 이 하위 조회에도 적용된다.
create policy items_select on public.items
  for select to anon, authenticated
  using (exists (select 1 from public.sets s where s.id = items.set_id));
create policy items_insert_admin on public.items
  for insert to authenticated
  with check ((select public.is_admin()));
create policy items_update_admin on public.items
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy items_delete_admin on public.items
  for delete to authenticated
  using ((select public.is_admin()));

-- ── 시퀀스 권한 ──────────────────────────────────────────────────────────
-- `revoke all on table` 은 identity 시퀀스에 닿지 않는다. Supabase 기본 권한이 anon·authenticated 에게
-- 시퀀스의 usage·select·update 를 주므로 따로 회수한다. identity 컬럼의 insert 는 시퀀스 권한 없이도 된다.
revoke all on sequence public.series_id_seq, public.sets_id_seq, public.items_id_seq
  from anon, authenticated;

-- ── Storage: 굿즈 이미지 ─────────────────────────────────────────────────
-- 공개 읽기(공개 주소), 업로드·수정·삭제는 운영자만. 운영자가 직접 촬영한 사진만 올린다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('goods', 'goods', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy goods_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'goods' and (select public.is_admin()));
create policy goods_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'goods' and (select public.is_admin()));
create policy goods_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'goods' and (select public.is_admin()))
  with check (bucket_id = 'goods' and (select public.is_admin()));
create policy goods_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'goods' and (select public.is_admin()));
