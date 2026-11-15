import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";

import { createUser, must, service, visitor, type TestUser } from "./helpers";

// TASKS 2.3 — docs/testing.md 의 R1, R2, R3, R18, R19 (3.3), P10 (3.2), C1 의 DB 제약 (3.6), G1~G8 (3.6.1).
// 설계는 docs/architecture.md 3.3, 4장.
// - 빈 결과를 단언하는 테스트는 "켜면 나온다 / 본인은 읽는다" 대조군을 함께 둔다.
// - 양·구 뷰는 본인 세션과 service role(매처가 읽는 경로) 양쪽에서 읽어 같은지 본다.
const DENIED = "42501";
const CHECK = "23514";
const NOT_INTEGER = "22P02";
/** 존재하지 않는 세트·아이템 id */
const NO_SUCH_ID = 9007199254740991;
const uniq = () => randomUUID().slice(0, 8);

/** 아이템 count 개짜리 세트 (service 로 준비) */
async function seedSet(count: number, isPublished = true) {
  const tag = uniq();
  const series = must(
    await service.from("series").insert({ name: `도감 테스트 작품 ${tag}`, slug: `col-${tag}` }).select("id").single(),
  );
  const set = must(
    await service
      .from("sets")
      .insert({ series_id: series.id, name: `도감 테스트 세트 ${tag}`, kind: "can_badge", is_published: isPublished })
      .select("id")
      .single(),
  );
  const items = must(
    await service
      .from("items")
      .insert(Array.from({ length: count }, (_, i) => ({ set_id: set.id, name: `아이템 ${i}`, sort_order: i })))
      .select("id, sort_order"),
  );
  return {
    setId: set.id as number,
    items: items.sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id as number),
  };
}

// 아래 준비 함수는 전부 "그 사용자의 세션" 으로 쓴다. 사용자가 실제로 할 수 있는 동작만으로 상태를 만든다.
const addSet = async (u: TestUser, setId: number, values: Record<string, unknown> = {}) =>
  must(await u.client.from("collection_sets").insert({ user_id: u.id, set_id: setId, ...values }));

const own = async (u: TestUser, itemId: number, ownedQty: number, values: Record<string, unknown> = {}) =>
  must(await u.client.from("collection_entries").insert({ user_id: u.id, item_id: itemId, owned_qty: ownedQty, ...values }));

const pick = async (u: TestUser, itemId: number, priority = 0) =>
  must(await u.client.from("wants").insert({ user_id: u.id, item_id: itemId, priority }));

/** 본인 칸 수정. 결과를 그대로 돌려준다 (거부 단언용) */
const edit = (u: TestUser, itemId: number, values: Record<string, unknown>) =>
  u.client.from("collection_entries").update(values).eq("user_id", u.id).eq("item_id", itemId).select("item_id");

/** 본인 세트 설정 변경. 한 행이 바뀌어야 한다 */
async function switchSet(u: TestUser, setId: number, values: Record<string, unknown>) {
  const changed = must(
    await u.client.from("collection_sets").update(values).eq("user_id", u.id).eq("set_id", setId).select("set_id"),
  );
  expect(changed).toEqual([{ set_id: setId }]);
}

const readViews = async (client: SupabaseClient, userId: string) => ({
  haves: must(await client.from("tradable_haves").select("item_id, qty").eq("user_id", userId).order("item_id")) as {
    item_id: number;
    qty: number;
  }[],
  wants: must(await client.from("wanted_items").select("item_id, priority").eq("user_id", userId).order("item_id")) as {
    item_id: number;
    priority: number;
  }[],
});

/** 양·구를 본인 세션과 service role 양쪽에서 읽는다. 두 경로의 결과가 같아야 한다 */
async function views(u: TestUser) {
  const mine = await readViews(u.client, u.id);
  const matcher = await readViews(service, u.id);
  expect(matcher, "service role(매처 경로)과 본인 세션의 결과가 같다").toEqual(mine);
  return mine;
}

const waitingSince = async (u: TestUser, itemId: number) => {
  const rows = must(
    await u.client.from("wanted_items").select("waiting_since").eq("user_id", u.id).eq("item_id", itemId),
  ) as { waiting_since: string }[];
  expect(rows).toHaveLength(1);
  return new Date(rows[0].waiting_since).getTime();
};

/** 교환을 켠 세트 하나: 양 1종(보유 3 → 양 2), 구 1종(빈칸), wants 1행 */
async function tradingUser() {
  const [u, s] = await Promise.all([createUser(), seedSet(2)]);
  await addSet(u, s.setId, { trade_enabled: true });
  await own(u, s.items[0], 3);
  await pick(u, s.items[1], 1);
  return { u, ...s };
}

describe("R1 타인의 도감 차단: A 는 B 의 도감을 읽을 수 없다", () => {
  test("A 는 B 의 collection_sets, collection_entries, wants 를 읽지 못한다 (B 는 읽는다)", async () => {
    const [{ u: b, setId, items }, a] = await Promise.all([tradingUser(), createUser()]);
    const read = async (client: SupabaseClient) => ({
      sets: (await client.from("collection_sets").select("set_id, trade_enabled, want_mode").eq("user_id", b.id)).data,
      entries: (await client.from("collection_entries").select("item_id, owned_qty").eq("user_id", b.id)).data,
      wants: (await client.from("wants").select("item_id, priority").eq("user_id", b.id)).data,
    });

    // 대조군: B 본인에게는 보인다
    expect(await read(b.client)).toEqual({
      sets: [{ set_id: setId, trade_enabled: true, want_mode: "all_missing" }],
      entries: [{ item_id: items[0], owned_qty: 3 }],
      wants: [{ item_id: items[1], priority: 1 }],
    });
    expect(await read(a.client)).toEqual({ sets: [], entries: [], wants: [] });
  });

  test("A 는 조건 없는 조회, 개수 세기, 임베딩으로도 B 의 도감을 볼 수 없다", async () => {
    const [{ u: b, setId, items }, a] = await Promise.all([tradingUser(), createUser()]);

    const all = await Promise.all([
      a.client.from("collection_sets").select("user_id"),
      a.client.from("collection_entries").select("user_id"),
      a.client.from("wants").select("user_id"),
    ]);
    const counted = await a.client.from("collection_entries").select("item_id", { count: "exact", head: true }).eq("item_id", items[0]);
    const viaProfile = await a.client
      .from("profiles")
      .select("id, collection_sets(set_id), collection_entries(item_id), wants(item_id)")
      .eq("id", b.id);
    const viaItem = await a.client.from("items").select("id, collection_entries(owned_qty), wants(priority)").eq("set_id", setId).order("id");
    const viaSet = await a.client.from("sets").select("id, collection_sets(user_id, trade_enabled)").eq("id", setId);

    for (const result of all) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    expect(counted.count).toBe(0);
    expect(viaProfile.data).toEqual([{ id: b.id, collection_sets: [], collection_entries: [], wants: [] }]);
    expect(viaItem.data).toEqual(items.map((id) => ({ id, collection_entries: [], wants: [] })));
    expect(viaSet.data).toEqual([{ id: setId, collection_sets: [] }]);
    // 대조군: 같은 임베딩을 B 가 하면 자기 행이 나온다
    const mine = await b.client.from("sets").select("id, collection_sets(user_id, trade_enabled)").eq("id", setId);
    expect(mine.data).toEqual([{ id: setId, collection_sets: [{ user_id: b.id, trade_enabled: true }] }]);
  });
});

describe("R18 양·구 뷰: 사용자 세션으로는 자기 행만 나온다", () => {
  test("A 는 뷰로도 B 의 양·구를 볼 수 없고, 조건 없이 읽으면 자기 것만 나온다", async () => {
    const [{ u: b, items: bItems }, { u: a, items: aItems }] = await Promise.all([tradingUser(), tradingUser()]);

    // 대조군: B 의 양·구는 실제로 있다 (본인 세션과 service role 양쪽)
    expect(await views(b)).toEqual({
      haves: [{ item_id: bItems[0], qty: 2 }],
      wants: [{ item_id: bItems[1], priority: 1 }],
    });
    expect(await readViews(a.client, b.id)).toEqual({ haves: [], wants: [] });

    const haves = must(await a.client.from("tradable_haves").select("user_id, item_id"));
    const wants = must(await a.client.from("wanted_items").select("user_id, item_id"));
    expect(haves).toEqual([{ user_id: a.id, item_id: aItems[0] }]);
    expect(wants).toEqual([{ user_id: a.id, item_id: aItems[1] }]);
  });

  test("뷰에는 쓸 수 없다", async () => {
    const { u, items } = await tradingUser();

    const insert = await u.client.from("tradable_haves").insert({ user_id: u.id, item_id: items[1], qty: 9 });
    const update = await u.client.from("tradable_haves").update({ qty: 9 }).eq("user_id", u.id);
    const remove = await u.client.from("wanted_items").delete().eq("user_id", u.id);

    // 조인 뷰라 권한 검사보다 먼저 "갱신할 수 없는 뷰"(55000)로 거부된다. 권한도 select 만 준다.
    for (const result of [insert, update, remove]) expect([DENIED, "55000"]).toContain(result.error?.code);
    expect(must(await service.from("collection_entries").select("item_id, owned_qty").eq("user_id", u.id))).toEqual([
      { item_id: items[0], owned_qty: 3 },
    ]);
    expect(await views(u)).toEqual({
      haves: [{ item_id: items[0], qty: 2 }],
      wants: [{ item_id: items[1], priority: 1 }],
    });
  });
});

describe("R2 타인의 도감 쓰기 차단", () => {
  test("A 는 B 의 이름으로 도감 행을 만들 수 없다", async () => {
    const [a, b, s] = await Promise.all([createUser(), createUser(), seedSet(1)]);

    const results = [
      await a.client.from("collection_sets").insert({ user_id: b.id, set_id: s.setId, trade_enabled: true }),
      await a.client.from("collection_entries").insert({ user_id: b.id, item_id: s.items[0], owned_qty: 5 }),
      await a.client.from("wants").insert({ user_id: b.id, item_id: s.items[0] }),
    ];

    for (const result of results) expect(result.error?.code).toBe(DENIED);
    expect(must(await service.from("collection_sets").select("set_id").eq("user_id", b.id))).toEqual([]);
    expect(must(await service.from("collection_entries").select("item_id").eq("user_id", b.id))).toEqual([]);
    expect(must(await service.from("wants").select("item_id").eq("user_id", b.id))).toEqual([]);
    // 대조군: 같은 행을 A 자신의 이름으로는 만들 수 있다
    await addSet(a, s.setId);
    await own(a, s.items[0], 5);
  });

  test("A 는 B 의 세트 스위치·want_mode·칸·구 목록을 고치거나 지울 수 없다", async () => {
    const [{ u: b, setId, items }, a] = await Promise.all([tradingUser(), createUser()]);
    const snapshot = async () => ({
      sets: must(await service.from("collection_sets").select("set_id, trade_enabled, want_mode").eq("user_id", b.id)),
      entries: must(
        await service.from("collection_entries").select("item_id, owned_qty, keep_qty, trade_enabled").eq("user_id", b.id),
      ),
      wants: must(await service.from("wants").select("item_id, priority").eq("user_id", b.id)),
    });
    const before = await snapshot();

    const attempts = [
      await a.client.from("collection_sets").update({ trade_enabled: false }).eq("user_id", b.id).select("set_id"),
      await a.client.from("collection_sets").update({ want_mode: "selected" }).eq("set_id", setId).select("set_id"),
      await a.client.from("collection_sets").delete().eq("user_id", b.id).select("set_id"),
      await a.client.from("collection_entries").update({ owned_qty: 0 }).eq("user_id", b.id).select("item_id"),
      await a.client.from("collection_entries").update({ trade_enabled: false, keep_qty: 3 }).eq("item_id", items[0]).select("item_id"),
      await a.client.from("collection_entries").delete().eq("user_id", b.id).select("item_id"),
      await a.client.from("wants").update({ priority: 9 }).eq("user_id", b.id).select("item_id"),
      await a.client.from("wants").delete().eq("item_id", items[1]).select("item_id"),
    ];

    // RLS 에 걸린 update·delete 는 오류 없이 0행이다
    for (const result of attempts) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    expect(await snapshot()).toEqual(before);
    // 대조군: B 본인은 같은 수정을 할 수 있다
    await switchSet(b, setId, { trade_enabled: false, want_mode: "selected" });
    expect((await edit(b, items[0], { owned_qty: 4 })).data).toEqual([{ item_id: items[0] }]);
  });

  test("자기 행의 주인을 바꾸거나 시각 컬럼을 쓸 수 없다", async () => {
    const [{ u: a, setId, items }, b] = await Promise.all([tradingUser(), createUser()]);
    const past = "2000-01-01T00:00:00Z";

    const results = [
      await a.client.from("collection_sets").update({ user_id: b.id }).eq("user_id", a.id),
      await a.client.from("collection_entries").update({ user_id: b.id }).eq("user_id", a.id),
      await a.client.from("wants").update({ user_id: b.id }).eq("user_id", a.id),
      await a.client.from("collection_entries").update({ item_id: items[1] }).eq("user_id", a.id),
      await a.client.from("collection_sets").update({ added_at: past }).eq("user_id", a.id),
      await a.client.from("collection_entries").update({ updated_at: past }).eq("user_id", a.id),
      await a.client.from("collection_sets").insert({ user_id: a.id, set_id: (await seedSet(1)).setId, added_at: past }),
      await a.client.from("collection_entries").insert({ user_id: a.id, item_id: items[1], owned_qty: 0, updated_at: past }),
    ];

    for (const result of results) expect(result.error?.code).toBe(DENIED);
    expect(must(await service.from("collection_sets").select("set_id").eq("user_id", b.id))).toEqual([]);
    expect(must(await service.from("collection_entries").select("item_id").eq("user_id", b.id))).toEqual([]);
    expect(must(await service.from("collection_sets").select("set_id").eq("user_id", a.id))).toEqual([{ set_id: setId }]);
  });
});

describe("R3 방문자는 도감에서 아무것도 읽지 못한다", () => {
  test("방문자는 도감 테이블과 양·구 뷰를 읽거나 쓸 수 없다 (본인은 읽는다)", async () => {
    const { u: b, setId, items } = await tradingUser();
    const anon = visitor();
    // 대조군: 읽을 행이 실제로 있다
    expect(must(await b.client.from("collection_sets").select("set_id").eq("user_id", b.id))).toEqual([{ set_id: setId }]);
    expect((await views(b)).haves).toHaveLength(1);

    const reads = [
      await anon.from("collection_sets").select("user_id"),
      await anon.from("collection_entries").select("user_id"),
      await anon.from("wants").select("user_id"),
      await anon.from("tradable_haves").select("user_id"),
      await anon.from("wanted_items").select("user_id"),
      await anon.from("items").select("id, collection_entries(owned_qty)").eq("id", items[0]),
    ];
    const writes = [
      await anon.from("collection_sets").insert({ user_id: b.id, set_id: setId }),
      await anon.from("collection_entries").update({ owned_qty: 0 }).eq("user_id", b.id),
      await anon.from("wants").delete().eq("user_id", b.id),
    ];

    for (const result of [...reads, ...writes]) {
      expect(result.error?.code).toBe(DENIED);
      expect(result.data).toBeNull();
    }
    expect(must(await service.from("collection_entries").select("owned_qty").eq("user_id", b.id))).toEqual([{ owned_qty: 3 }]);
    expect(must(await service.from("wants").select("item_id").eq("user_id", b.id))).toEqual([{ item_id: items[1] }]);
  });
});

describe("R19 읽을 수 없는 세트·아이템은 도감에 넣을 수 없다", () => {
  test("비공개 세트·아이템은 RLS 거부(42501)이고, 없는 id 와 구분되지 않는다", async () => {
    const [a, hidden, open] = await Promise.all([createUser(), seedSet(1, false), seedSet(1)]);
    const tryAll = async (setId: number, itemId: number) => [
      await a.client.from("collection_sets").insert({ user_id: a.id, set_id: setId }),
      await a.client.from("collection_entries").insert({ user_id: a.id, item_id: itemId, owned_qty: 1 }),
      await a.client.from("wants").insert({ user_id: a.id, item_id: itemId }),
    ];

    const forHidden = await tryAll(hidden.setId, hidden.items[0]);
    const forMissing = await tryAll(NO_SUCH_ID, NO_SUCH_ID);

    // FK 오류(23503)가 아니라 RLS 거부다. 비공개 세트와 없는 세트의 응답이 같다.
    for (const result of [...forHidden, ...forMissing]) expect(result.error?.code).toBe(DENIED);
    expect(forHidden.map((r) => r.error?.message)).toEqual(forMissing.map((r) => r.error?.message));
    expect(must(await service.from("collection_sets").select("set_id").eq("user_id", a.id))).toEqual([]);
    expect(must(await service.from("collection_entries").select("item_id").eq("user_id", a.id))).toEqual([]);
    expect(must(await service.from("wants").select("item_id").eq("user_id", a.id))).toEqual([]);
    // 대조군: 공개 세트·아이템은 들어간다
    for (const result of await tryAll(open.setId, open.items[0])) expect(result.error).toBeNull();
  });
});

describe("P10 reserved_qty 는 사용자가 쓸 수 없다", () => {
  test("insert 로도 update 로도 reserved_qty 를 바꿀 수 없다", async () => {
    const [a, s] = await Promise.all([createUser(), seedSet(2)]);
    await own(a, s.items[0], 3);

    const insertOne = await a.client
      .from("collection_entries")
      .insert({ user_id: a.id, item_id: s.items[1], owned_qty: 3, reserved_qty: 1 });
    const insertZero = await a.client
      .from("collection_entries")
      .insert({ user_id: a.id, item_id: s.items[1], owned_qty: 3, reserved_qty: 0 });
    const update = await edit(a, s.items[0], { reserved_qty: 1 });
    const mixed = await edit(a, s.items[0], { owned_qty: 5, reserved_qty: 1 });

    for (const result of [insertOne, insertZero, update, mixed]) expect(result.error?.code).toBe(DENIED);
    expect(must(await service.from("collection_entries").select("item_id, owned_qty, reserved_qty").eq("user_id", a.id))).toEqual([
      { item_id: s.items[0], owned_qty: 3, reserved_qty: 0 },
    ]);
    // 대조군: reserved_qty 만 빼면 같은 수정이 된다
    expect((await edit(a, s.items[0], { owned_qty: 5 })).data).toEqual([{ item_id: s.items[0] }]);
  });

  test("예약이 있는 칸은 지울 수 없다 (예약이 없는 칸은 지워진다)", async () => {
    const [a, s] = await Promise.all([createUser(), seedSet(2)]);
    await own(a, s.items[0], 3);
    await own(a, s.items[1], 3);
    must(await service.from("collection_entries").update({ reserved_qty: 1 }).eq("user_id", a.id).eq("item_id", s.items[0]));

    const removed = await a.client.from("collection_entries").delete().eq("user_id", a.id).select("item_id");

    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([{ item_id: s.items[1] }]);
    expect(must(await service.from("collection_entries").select("item_id, reserved_qty").eq("user_id", a.id))).toEqual([
      { item_id: s.items[0], reserved_qty: 1 },
    ]);
  });
});

describe("C1 소장 개수와 보유 수량의 DB 제약", () => {
  test("소장 개수가 보유보다 크거나, 음수이거나, 정수가 아니면 거부된다. 비워 두는 것은 된다", async () => {
    const [a, s] = await Promise.all([createUser(), seedSet(2)]);
    await own(a, s.items[0], 2);
    const item = s.items[0];

    expect((await edit(a, item, { keep_qty: 3 })).error?.code).toBe(CHECK);
    expect((await edit(a, item, { keep_qty: -1 })).error?.code).toBe(CHECK);
    expect((await edit(a, item, { owned_qty: -1 })).error?.code).toBe(CHECK);
    expect((await edit(a, item, { keep_qty: 1.5 })).error?.code).toBe(NOT_INTEGER);
    expect((await edit(a, item, { owned_qty: 1.5 })).error?.code).toBe(NOT_INTEGER);
    const insert = await a.client.from("collection_entries").insert({ user_id: a.id, item_id: s.items[1], owned_qty: 1, keep_qty: 2 });
    expect(insert.error?.code).toBe(CHECK);
    expect(must(await service.from("collection_entries").select("item_id, owned_qty, keep_qty").eq("user_id", a.id))).toEqual([
      { item_id: item, owned_qty: 2, keep_qty: null },
    ]);

    // 허용: 0, 보유와 같은 값, 다시 비우기(null = 기본)
    for (const keepQty of [0, 2, null]) {
      const ok = await edit(a, item, { keep_qty: keepQty });
      expect(ok.error, String(keepQty)).toBeNull();
      expect(ok.data).toEqual([{ item_id: item }]);
    }
  });
});

describe("G1 기록만 한 사용자는 양에도 구에도 없다", () => {
  test("세트 스위치를 켜지 않으면 두 뷰 모두 0행이다 (켜면 나온다)", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(3)]);
    await addSet(u, s.setId);
    await own(u, s.items[0], 3);
    await own(u, s.items[1], 0);

    // 기본값: 스위치 꺼짐, 빈칸 전부 구하기
    expect(must(await u.client.from("collection_sets").select("trade_enabled, want_mode").eq("user_id", u.id))).toEqual([
      { trade_enabled: false, want_mode: "all_missing" },
    ]);
    expect(await views(u)).toEqual({ haves: [], wants: [] });

    // 대조군: 스위치만 켜면 같은 도감에서 양·구가 나온다
    await switchSet(u, s.setId, { trade_enabled: true });
    expect(await views(u)).toEqual({
      haves: [{ item_id: s.items[0], qty: 2 }],
      wants: [
        { item_id: s.items[1], priority: 0 },
        { item_id: s.items[2], priority: 0 },
      ],
    });
  });
});

describe("G2 켰을 때 기본은 종류마다 하나 소장", () => {
  test("보유 1 은 양이 아니고, 2 는 양 1개, 3 은 양 2개, 0 은 구다. 0→2 로 올리면 양 1개가 된다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(4)]);
    await addSet(u, s.setId, { trade_enabled: true });
    const [one, two, three, zero] = s.items;
    await own(u, one, 1);
    await own(u, two, 2);
    await own(u, three, 3);
    await own(u, zero, 0);

    expect(await views(u)).toEqual({
      haves: [
        { item_id: two, qty: 1 },
        { item_id: three, qty: 2 },
      ],
      wants: [{ item_id: zero, priority: 0 }],
    });

    expect((await edit(u, zero, { owned_qty: 2 })).error).toBeNull();
    expect(await views(u)).toEqual({
      haves: [
        { item_id: two, qty: 1 },
        { item_id: three, qty: 2 },
        { item_id: zero, qty: 1 },
      ],
      wants: [],
    });
  });
});

describe("G3 칸별 예외", () => {
  test("꺼 둔 칸은 양이 아니고, keep_qty 로 소장 개수를 바꾸며, null 로 되돌리면 기본이다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(3)]);
    await addSet(u, s.setId, { trade_enabled: true });
    const [off, keepNone, keepTwo] = s.items;
    await own(u, off, 3, { trade_enabled: false });
    await own(u, keepNone, 3, { keep_qty: 0 });
    await own(u, keepTwo, 3, { keep_qty: 2 });

    expect((await views(u)).haves).toEqual([
      { item_id: keepNone, qty: 3 },
      { item_id: keepTwo, qty: 1 },
    ]);

    // null 로 되돌리면 기본(하나 소장), 칸을 다시 켜면 양에 나온다 (대조군)
    expect((await edit(u, keepTwo, { keep_qty: null })).error).toBeNull();
    expect((await edit(u, off, { trade_enabled: true })).error).toBeNull();
    expect((await views(u)).haves).toEqual([
      { item_id: off, qty: 2 },
      { item_id: keepNone, qty: 3 },
      { item_id: keepTwo, qty: 2 },
    ]);
  });
});

describe("G4 고른 것만 구하기 (want_mode = selected)", () => {
  test("wants 에 있는 보유 0 인 아이템만 구다. 고르지 않은 빈칸은 구가 아니다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(3)]);
    const [picked, notPicked, pickedButOwned] = s.items;
    await addSet(u, s.setId, { trade_enabled: true });
    await own(u, pickedButOwned, 1);
    // 대조군: 빈칸 전부 구하기에서는 빈칸 둘 다 구다
    expect((await views(u)).wants.map((w) => w.item_id)).toEqual([picked, notPicked]);

    await switchSet(u, s.setId, { want_mode: "selected" });
    // wants 가 비어 있으면 구는 0행
    expect((await views(u)).wants).toEqual([]);

    await pick(u, picked, 2);
    await pick(u, pickedButOwned, 5);
    expect((await views(u)).wants).toEqual([{ item_id: picked, priority: 2 }]);
  });

  test("대기 시간은 고른 시각이고, 칸을 나중에 고쳐도 바뀌지 않는다. created_at 은 직접 쓸 수 없다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(2)]);
    const [picked, other] = s.items;
    await addSet(u, s.setId, { trade_enabled: true, want_mode: "selected" });
    await pick(u, picked);
    const createdAt = new Date(
      must(await service.from("wants").select("created_at").eq("user_id", u.id).eq("item_id", picked).single()).created_at,
    ).getTime();

    expect(await waitingSince(u, picked)).toBe(createdAt);

    // 칸을 만들고 고쳐도(updated_at 이 바뀌어도) 대기 시간은 그대로다
    await own(u, picked, 0);
    expect((await edit(u, picked, { trade_enabled: false })).error).toBeNull();
    expect((await u.client.from("wants").update({ priority: 3 }).eq("user_id", u.id).eq("item_id", picked)).error).toBeNull();
    expect(await waitingSince(u, picked)).toBe(createdAt);

    const past = "2000-01-01T00:00:00Z";
    const insert = await u.client.from("wants").insert({ user_id: u.id, item_id: other, created_at: past });
    const update = await u.client.from("wants").update({ created_at: past }).eq("user_id", u.id);
    expect(insert.error?.code).toBe(DENIED);
    expect(update.error?.code).toBe(DENIED);
    expect(await waitingSince(u, picked)).toBe(createdAt);
  });
});

describe("G5 빈칸 전부 구하기 (want_mode = all_missing)", () => {
  test("wants 에 없어도 빈칸 전부가 구이고, wants 는 우선순위로만 나타난다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(3)]);
    const [bare, prioritized, owned] = s.items;
    await addSet(u, s.setId, { trade_enabled: true });
    await own(u, owned, 1);
    await pick(u, prioritized, 5);
    // 보유 중인 아이템의 wants 는 구를 만들지 않는다
    await pick(u, owned, 9);

    expect((await views(u)).wants).toEqual([
      { item_id: bare, priority: 0 },
      { item_id: prioritized, priority: 5 },
    ]);
  });

  test("대기 시간은 칸 수정 시각, 칸이 없으면 세트 추가 시각이다 (wants 의 시각을 쓰지 않는다)", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(2)]);
    const [noEntry, withEntry] = s.items;
    await addSet(u, s.setId, { trade_enabled: true });
    await pick(u, noEntry);
    await pick(u, withEntry);
    await own(u, withEntry, 1);
    const time = (value: string) => new Date(value).getTime();
    const updatedAt = async () =>
      time(must(await service.from("collection_entries").select("updated_at").eq("user_id", u.id).eq("item_id", withEntry).single()).updated_at);
    const insertedAt = await updatedAt();

    // 보유를 0 으로 고치면 updated_at 이 갱신되고, 그 시각이 대기 시간이다
    expect((await edit(u, withEntry, { owned_qty: 0 })).error).toBeNull();
    const editedAt = await updatedAt();
    const addedAt = time(must(await service.from("collection_sets").select("added_at").eq("user_id", u.id).single()).added_at);
    const picks = must(await service.from("wants").select("item_id, created_at").eq("user_id", u.id)) as {
      item_id: number;
      created_at: string;
    }[];
    const pickedAt = (itemId: number) => time(picks.find((p) => p.item_id === itemId)!.created_at);

    expect(editedAt).toBeGreaterThan(insertedAt);
    expect(await waitingSince(u, withEntry)).toBe(editedAt);
    expect(await waitingSince(u, noEntry)).toBe(addedAt);
    expect(editedAt).not.toBe(pickedAt(withEntry));
    expect(addedAt).not.toBe(pickedAt(noEntry));
  });
});

describe("G6 스위치를 다시 끄면", () => {
  test("그 세트의 양·구가 사라지고, 다른 세트는 그대로이며, reserved_qty 는 바뀌지 않는다", async () => {
    const [u, first, second] = await Promise.all([createUser(), seedSet(2), seedSet(2)]);
    for (const s of [first, second]) {
      await addSet(u, s.setId, { trade_enabled: true });
      await own(u, s.items[0], 3);
    }
    // 매처가 제안하며 예약한 상태를 흉내 낸다 (propose_match 는 Sprint 4)
    must(await service.from("collection_entries").update({ reserved_qty: 1 }).eq("user_id", u.id).eq("item_id", first.items[0]));
    const rest = {
      haves: [{ item_id: second.items[0], qty: 2 }],
      wants: [{ item_id: second.items[1], priority: 0 }],
    };
    // 대조군: 끄기 전에는 두 세트 모두 나온다 (예약 1 은 양에서 빠져 있다)
    expect(await views(u)).toEqual({
      haves: [{ item_id: first.items[0], qty: 1 }, ...rest.haves],
      wants: [{ item_id: first.items[1], priority: 0 }, ...rest.wants],
    });

    await switchSet(u, first.setId, { trade_enabled: false });

    expect(await views(u)).toEqual(rest);
    expect(
      must(await service.from("collection_entries").select("reserved_qty").eq("user_id", u.id).eq("item_id", first.items[0])),
    ).toEqual([{ reserved_qty: 1 }]);
  });
});

describe("G7 도감에서 뺀 세트, 비공개로 돌린 세트", () => {
  test("세트를 도감에서 빼면 남아 있는 칸은 양에 잡히지 않는다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(2)]);
    await addSet(u, s.setId, { trade_enabled: true });
    await own(u, s.items[0], 3);
    expect((await views(u)).haves).toEqual([{ item_id: s.items[0], qty: 2 }]);

    const removed = await u.client.from("collection_sets").delete().eq("user_id", u.id).eq("set_id", s.setId).select("set_id");

    expect(removed.data).toEqual([{ set_id: s.setId }]);
    expect(await views(u)).toEqual({ haves: [], wants: [] });
    // 칸은 남아 있다
    expect(must(await u.client.from("collection_entries").select("item_id, owned_qty").eq("user_id", u.id))).toEqual([
      { item_id: s.items[0], owned_qty: 3 },
    ]);
  });

  test("운영자가 세트를 비공개로 돌리면 양·구에서 빠진다 (service role 로 읽어도)", async () => {
    const [u, hiddenLater, stays] = await Promise.all([createUser(), seedSet(2), seedSet(2)]);
    for (const s of [hiddenLater, stays]) {
      await addSet(u, s.setId, { trade_enabled: true });
      await own(u, s.items[0], 3);
    }
    expect((await views(u)).haves).toHaveLength(2);
    expect((await views(u)).wants).toHaveLength(2);

    must(await service.from("sets").update({ is_published: false }).eq("id", hiddenLater.setId));

    // views() 가 본인 세션과 service role 의 결과가 같은지도 함께 확인한다
    expect(await views(u)).toEqual({
      haves: [{ item_id: stays.items[0], qty: 2 }],
      wants: [{ item_id: stays.items[1], priority: 0 }],
    });
    // 대조군: 다시 공개하면 돌아온다
    must(await service.from("sets").update({ is_published: true }).eq("id", hiddenLater.setId));
    expect((await views(u)).haves).toHaveLength(2);
  });
});

describe("G8 값의 범위", () => {
  test("want_mode 는 두 값만 받는다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(1)]);
    await addSet(u, s.setId);
    const set = (wantMode: string) =>
      u.client.from("collection_sets").update({ want_mode: wantMode }).eq("user_id", u.id).select("want_mode");

    expect((await set("everything")).error?.code).toBe(CHECK);
    expect((await set("selected")).data).toEqual([{ want_mode: "selected" }]);
    expect((await set("all_missing")).data).toEqual([{ want_mode: "all_missing" }]);
  });

  test("실제 소장과 예약의 합이 보유를 넘는 수정은 거부된다", async () => {
    const [u, s] = await Promise.all([createUser(), seedSet(1)]);
    const item = s.items[0];
    await own(u, item, 3);
    const reserve = (qty: number) =>
      service.from("collection_entries").update({ reserved_qty: qty }).eq("user_id", u.id).eq("item_id", item);
    // 보유 3, 기본 소장 1, 예약 2 → 남는 것 0
    must(await reserve(2));

    expect((await edit(u, item, { owned_qty: 2 })).error?.code).toBe(CHECK);
    expect((await edit(u, item, { keep_qty: 2 })).error?.code).toBe(CHECK);
    expect((await reserve(3)).error?.code).toBe(CHECK);
    expect((await reserve(-1)).error?.code).toBe(CHECK);
    expect(must(await service.from("collection_entries").select("owned_qty, keep_qty, reserved_qty").eq("user_id", u.id))).toEqual([
      { owned_qty: 3, keep_qty: null, reserved_qty: 2 },
    ]);
    // 대조군: 제약을 지키는 수정은 된다 (보유를 늘리거나 소장을 줄인다)
    expect((await edit(u, item, { owned_qty: 4, keep_qty: 2 })).error).toBeNull();
    expect((await edit(u, item, { keep_qty: 0 })).error).toBeNull();
  });
});
