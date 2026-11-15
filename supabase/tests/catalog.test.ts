import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { createAdmin, createUser, must, service, visitor } from "./helpers";

// TASKS 2.2 — docs/testing.md 3.3 의 R4.
// 방문자와 사용자는 공개된 세트·아이템만 읽고, 비공개 세트는 운영자만 읽는다. 카탈로그 쓰기는 운영자만 한다.
const DENIED = "42501";
const uniq = () => randomUUID().slice(0, 8);

/** 공개 세트 하나와 비공개 세트 하나, 각각 아이템 하나 (service 로 준비) */
async function seedCatalog() {
  const tag = uniq();
  const series = must(
    await service.from("series").insert({ name: `테스트 작품 ${tag}`, slug: `test-${tag}` }).select("id").single(),
  );
  const newSet = async (name: string, isPublished: boolean) =>
    must(
      await service
        .from("sets")
        .insert({ series_id: series.id, name, kind: "can_badge", is_published: isPublished })
        .select("id")
        .single(),
    );
  const open = await newSet(`공개 세트 ${tag}`, true);
  const hidden = await newSet(`비공개 세트 ${tag}`, false);
  const newItem = async (setId: number, name: string) =>
    must(await service.from("items").insert({ set_id: setId, name, sort_order: 1 }).select("id").single());
  const openItem = await newItem(open.id, "공개 아이템");
  const hiddenItem = await newItem(hidden.id, "비공개 아이템");
  return { seriesId: series.id, openId: open.id, hiddenId: hidden.id, openItemId: openItem.id, hiddenItemId: hiddenItem.id };
}

describe("R4 카탈로그 읽기: 공개된 것만 보인다", () => {
  test.each([
    ["방문자", async () => visitor()],
    ["사용자 A", async () => (await createUser()).client],
  ])("%s 는 공개 세트와 그 아이템만 읽는다", async (_who, makeClient) => {
    const c = await seedCatalog();
    const client = await makeClient();

    const series = await client.from("series").select("id").eq("id", c.seriesId);
    const sets = await client.from("sets").select("id, is_published").in("id", [c.openId, c.hiddenId]);
    const items = await client.from("items").select("id, set_id").in("id", [c.openItemId, c.hiddenItemId]);
    const viaSet = await client.from("sets").select("id, items(id)").eq("id", c.hiddenId);

    expect(series.data).toEqual([{ id: c.seriesId }]);
    expect(sets.error).toBeNull();
    expect(sets.data).toEqual([{ id: c.openId, is_published: true }]);
    expect(items.error).toBeNull();
    expect(items.data).toEqual([{ id: c.openItemId, set_id: c.openId }]);
    expect(viaSet.data).toEqual([]);
  });

  test.each([
    ["방문자", async () => visitor()],
    ["사용자 A", async () => (await createUser()).client],
  ])("%s 는 임베딩·개수 세기·직접 조회로도 비공개 세트를 알아낼 수 없다", async (_who, makeClient) => {
    const c = await seedCatalog();
    const client = await makeClient();

    const viaSeries = await client.from("series").select("id, sets(id, name)").eq("id", c.seriesId).single();
    const viaItem = await client.from("items").select("id, sets(id)").eq("id", c.hiddenItemId);
    const hiddenItem = await client.from("items").select("id").eq("set_id", c.hiddenId);
    const counted = await client.from("sets").select("id", { count: "exact", head: true }).eq("series_id", c.seriesId);
    const byName = await client.from("sets").select("id").like("name", "비공개 세트%").eq("series_id", c.seriesId);

    expect(viaSeries.data?.sets.map((s) => s.id)).toEqual([c.openId]);
    expect(viaItem.data).toEqual([]);
    expect(hiddenItem.data).toEqual([]);
    expect(counted.count).toBe(1);
    expect(byName.data).toEqual([]);
  });

  test("운영자는 비공개 세트와 그 아이템도 읽는다", async () => {
    const c = await seedCatalog();
    const admin = await createAdmin();

    const sets = await admin.client.from("sets").select("id").in("id", [c.openId, c.hiddenId]).order("id");
    const items = await admin.client.from("items").select("id").in("id", [c.openItemId, c.hiddenItemId]).order("id");

    expect(sets.data).toEqual([{ id: c.openId }, { id: c.hiddenId }]);
    expect(items.data).toEqual([{ id: c.openItemId }, { id: c.hiddenItemId }]);
  });

  test("세트를 비공개로 돌리면 사용자에게서 세트와 아이템이 함께 사라진다", async () => {
    const c = await seedCatalog();
    const a = await createUser();
    must(await service.from("sets").update({ is_published: false }).eq("id", c.openId));

    const sets = await a.client.from("sets").select("id").eq("id", c.openId);
    const items = await a.client.from("items").select("id").eq("id", c.openItemId);

    expect(sets.data).toEqual([]);
    expect(items.data).toEqual([]);
  });

  test.each([
    ["방문자", async () => visitor()],
    ["사용자 A", async () => (await createUser()).client],
  ])("%s 는 공개된 세트가 없는 작품을 볼 수 없다 (운영자는 본다)", async (_who, makeClient) => {
    const c = await seedCatalog();
    const client = await makeClient();
    const admin = await createAdmin();
    const count = () => client.from("series").select("id", { count: "exact", head: true }).eq("id", c.seriesId);
    const visible = await client.from("series").select("id").eq("id", c.seriesId);
    const countBefore = await count();
    must(await service.from("sets").update({ is_published: false }).eq("id", c.openId));

    const direct = await client.from("series").select("id, sets(id)").eq("id", c.seriesId);
    const bySlug = await client.from("series").select("id").like("slug", "test-%").in("id", [c.seriesId]);
    const countAfter = await count();
    const viaSet = await client.from("sets").select("id, series(name)").eq("series_id", c.seriesId);
    const forAdmin = await admin.client.from("series").select("id").eq("id", c.seriesId);

    // 대조군: 공개 세트가 있을 때는 보였고, 개수도 1 이었다
    expect(visible.data).toEqual([{ id: c.seriesId }]);
    expect(countBefore.count).toBe(1);
    expect(direct.data).toEqual([]);
    expect(bySlug.data).toEqual([]);
    expect(countAfter.count).toBe(0);
    expect(viaSet.data).toEqual([]);
    expect(forAdmin.data).toEqual([{ id: c.seriesId }]);
  });
});

describe("R4 카탈로그 쓰기: 운영자만 한다", () => {
  test.each([
    ["방문자", async () => visitor()],
    ["사용자 A", async () => (await createUser()).client],
  ])("%s 는 작품·세트·아이템을 만들거나 고치거나 지울 수 없다", async (_who, makeClient) => {
    const c = await seedCatalog();
    const client = await makeClient();
    const tag = uniq();

    const inserts = [
      await client.from("series").insert({ name: `몰래 ${tag}`, slug: `sneak-${tag}` }),
      await client.from("sets").insert({ series_id: c.seriesId, name: `몰래 ${tag}`, kind: "other", is_published: true }),
      await client.from("items").insert({ set_id: c.openId, name: `몰래 ${tag}`, sort_order: 99 }),
    ];
    for (const result of inserts) expect(result.error?.code).toBe(DENIED);

    // update·delete 는 권한 오류이거나(방문자) RLS 로 0행이다(사용자). 어느 쪽이든 값이 그대로여야 한다.
    await client.from("series").update({ name: "바뀜" }).eq("id", c.seriesId);
    await client.from("sets").update({ name: "바뀜" }).eq("id", c.openId);
    await client.from("sets").update({ is_published: true }).eq("id", c.hiddenId);
    await client.from("items").update({ name: "바뀜" }).eq("id", c.openItemId);
    await client.from("items").delete().eq("id", c.openItemId);
    await client.from("sets").delete().eq("id", c.hiddenId);
    await client.from("series").delete().eq("id", c.seriesId);

    expect(must(await service.from("series").select("name").eq("slug", `sneak-${tag}`))).toEqual([]);
    expect(must(await service.from("sets").select("id").eq("name", `몰래 ${tag}`))).toEqual([]);
    expect(must(await service.from("items").select("id").eq("name", `몰래 ${tag}`))).toEqual([]);
    expect(must(await service.from("series").select("name").eq("id", c.seriesId).single()).name).not.toBe("바뀜");
    const sets = must(await service.from("sets").select("id, name, is_published").in("id", [c.openId, c.hiddenId]).order("id"));
    expect(sets.map((s) => s.is_published)).toEqual([true, false]);
    expect(sets.every((s) => s.name !== "바뀜")).toBe(true);
    expect(must(await service.from("items").select("name").eq("id", c.openItemId))).toEqual([{ name: "공개 아이템" }]);
  });

  test("운영자는 작품·세트·아이템을 만들고, 공개로 바꾸고, 지울 수 있다", async () => {
    const admin = await createAdmin();
    const tag = uniq();

    const series = await admin.client.from("series").insert({ name: `운영 ${tag}`, slug: `admin-${tag}` }).select("id").single();
    expect(series.error).toBeNull();
    const set = await admin.client
      .from("sets")
      .insert({ series_id: series.data!.id, name: `운영 세트 ${tag}`, kind: "kuji", cell_ratio: "3:4" })
      .select("id, is_published, cell_ratio")
      .single();
    expect(set.error).toBeNull();
    expect(set.data).toMatchObject({ is_published: false, cell_ratio: "3:4" });
    const item = await admin.client.from("items").insert({ set_id: set.data!.id, name: "A상", sort_order: 1 }).select("id").single();
    expect(item.error).toBeNull();

    const publish = await admin.client.from("sets").update({ is_published: true }).eq("id", set.data!.id).select("is_published");
    expect(publish.data).toEqual([{ is_published: true }]);

    const removeItem = await admin.client.from("items").delete().eq("id", item.data!.id).select("id");
    expect(removeItem.data).toEqual([{ id: item.data!.id }]);
  });
});

describe("카탈로그 제약", () => {
  test("세트의 kind, cell_ratio 는 정해진 값만, 기본 칸 비율은 1:1 이다", async () => {
    const c = await seedCatalog();
    const base = { series_id: c.seriesId, name: `제약 ${uniq()}` };

    const badKind = await service.from("sets").insert({ ...base, kind: "figure" });
    const badRatio = await service.from("sets").insert({ ...base, kind: "kuji", cell_ratio: "16:9" });
    const blankName = await service.from("sets").insert({ ...base, name: "  ", kind: "kuji" });
    const ok = await service.from("sets").insert({ ...base, kind: "collab_cafe" }).select("cell_ratio, is_published").single();
    // "페어"는 fair(기획전)다. pair_bonus 는 없는 값이다
    const pair = await service.from("sets").insert({ ...base, kind: "pair_bonus" });
    const kinds = ["collab_cafe", "fair_bonus", "theater_bonus", "kuji", "can_badge", "other"];
    for (const kind of kinds) {
      const made = await service.from("sets").insert({ series_id: c.seriesId, name: `종류 ${kind} ${uniq()}`, kind });
      expect(made.error, kind).toBeNull();
    }
    expect(pair.error?.code).toBe("23514");

    expect(badKind.error?.code).toBe("23514");
    expect(badRatio.error?.code).toBe("23514");
    expect(blankName.error?.code).toBe("23514");
    expect(ok.data).toEqual({ cell_ratio: "1:1", is_published: false });
  });

  test("같은 세트 안에서 sort_order 는 겹칠 수 없다", async () => {
    const c = await seedCatalog();

    const duplicate = await service.from("items").insert({ set_id: c.openId, name: "겹침", sort_order: 1 });
    const next = await service.from("items").insert({ set_id: c.openId, name: "다음", sort_order: 2 });

    expect(duplicate.error?.code).toBe("23505");
    expect(next.error).toBeNull();
  });

  test("아이템이 있는 세트, 세트가 있는 작품은 지워지지 않는다", async () => {
    const c = await seedCatalog();

    const removeSet = await service.from("sets").delete().eq("id", c.openId);
    const removeSeries = await service.from("series").delete().eq("id", c.seriesId);

    expect(removeSet.error?.code).toBe("23503");
    expect(removeSeries.error?.code).toBe("23503");
  });

  test("slug 는 소문자·숫자·하이픈만 된다", async () => {
    const bad = await service.from("series").insert({ name: `슬러그 ${uniq()}`, slug: "Bad Slug" });

    expect(bad.error?.code).toBe("23514");
  });
});

describe("R4 굿즈 이미지 버킷: 공개 읽기, 운영자만 업로드", () => {
  // 1x1 PNG
  const png = () =>
    new Blob(
      [Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")],
      { type: "image/png" },
    );
  const publicUrl = (path: string) => service.storage.from("goods").getPublicUrl(path).data.publicUrl;

  test.each([
    ["방문자", async () => visitor()],
    ["사용자 A", async () => (await createUser()).client],
  ])("%s 는 업로드할 수 없다", async (_who, makeClient) => {
    const client = await makeClient();
    const path = `test/${randomUUID()}.png`;
    // 대조군: 버킷은 실제로 있고 공개다 (버킷이 없어서 실패하는 것이 아님을 확인)
    expect(must(await service.storage.getBucket("goods")).public).toBe(true);

    const upload = await client.storage.from("goods").upload(path, png());

    expect(upload.error).not.toBeNull();
    expect((await fetch(publicUrl(path))).ok).toBe(false);
  });

  test("운영자가 올린 사진은 방문자가 공개 주소로 읽는다", async () => {
    const admin = await createAdmin();
    const path = `test/${randomUUID()}.png`;

    const upload = await admin.client.storage.from("goods").upload(path, png());
    const response = await fetch(publicUrl(path));

    expect(upload.error).toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  test("사용자 A 는 운영자가 올린 사진을 덮어쓰거나 지울 수 없다", async () => {
    const [admin, a] = await Promise.all([createAdmin(), createUser()]);
    const path = `test/${randomUUID()}.png`;
    must(await admin.client.storage.from("goods").upload(path, png()));

    const overwrite = await a.client.storage.from("goods").upload(path, png(), { upsert: true });
    await a.client.storage.from("goods").remove([path]);

    expect(overwrite.error).not.toBeNull();
    expect((await fetch(publicUrl(path))).status).toBe(200);
  });

  test.each([
    ["방문자", async () => visitor()],
    ["사용자 A", async () => (await createUser()).client],
  ])("%s 는 버킷의 파일 목록을 볼 수 없고, 옮기거나 복사할 수 없다", async (_who, makeClient) => {
    const admin = await createAdmin();
    const client = await makeClient();
    const folder = `test-${randomUUID()}`;
    const path = `${folder}/a.png`;
    must(await admin.client.storage.from("goods").upload(path, png()));

    const list = await client.storage.from("goods").list(folder);
    const move = await client.storage.from("goods").move(path, `${folder}/moved.png`);
    const copy = await client.storage.from("goods").copy(path, `${folder}/copied.png`);

    expect(list.data ?? []).toEqual([]);
    expect(move.error).not.toBeNull();
    expect(copy.error).not.toBeNull();
    // 대조군: 운영자에게는 원래 파일 하나만 그대로 보인다
    const adminList = must(await admin.client.storage.from("goods").list(folder));
    expect(adminList.map((f) => f.name)).toEqual(["a.png"]);
  });

  test("운영자라도 이미지가 아닌 파일은 올릴 수 없다", async () => {
    const admin = await createAdmin();

    // 대조군: 같은 운영자의 PNG 는 올라간다 (버킷이 없어서 실패하는 것이 아님을 확인)
    const image = await admin.client.storage.from("goods").upload(`test/${randomUUID()}.png`, png());
    const upload = await admin.client.storage
      .from("goods")
      .upload(`test/${randomUUID()}.html`, new Blob(["<script>1</script>"], { type: "text/html" }));

    expect(image.error).toBeNull();
    expect(upload.error).not.toBeNull();
  });
});
