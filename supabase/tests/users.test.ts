import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { createAdmin, createUser, DOC_VERSION, must, randomNickname, service, visitor } from "./helpers";

// TASKS 2.1 — docs/testing.md 3.3 의 R5, R6, R16 과 profiles 권한.
// RLS 에 걸린 update·delete 는 오류 없이 0행이고, 컬럼·테이블 권한에 걸리면 42501 이다.
// 어느 쪽이든 service 로 다시 읽어 값이 그대로인지까지 확인한다.
const DENIED = "42501";

describe("R5 user_stats: 평판은 읽을 수 있지만 쓸 수 없다", () => {
  test("A 는 B 의 평판 횟수 3개를 읽는다", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);
    must(await service.from("user_stats").update({ completed_count: 4 }).eq("user_id", b.id));

    const { data, error } = await a.client
      .from("user_stats")
      .select("user_id, completed_count, confirmed_report_count, no_response_count")
      .eq("user_id", b.id);

    expect(error).toBeNull();
    expect(data).toEqual([
      { user_id: b.id, completed_count: 4, confirmed_report_count: 0, no_response_count: 0 },
    ]);
  });

  test("A 는 B 의 suspended_at, priority_since 를 읽을 수 없다", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);
    must(
      await service
        .from("user_stats")
        .update({ suspended_at: new Date().toISOString(), priority_since: new Date().toISOString() })
        .eq("user_id", b.id),
    );

    for (const columns of ["suspended_at", "priority_since", "*"]) {
      const { data, error } = await a.client.from("user_stats").select(columns).eq("user_id", b.id);
      expect(error?.code, columns).toBe(DENIED);
      expect(data, columns).toBeNull();
    }
    const viaFunction = await a.client.rpc("user_status", { p_user: b.id });
    expect(viaFunction.error?.code).toBe(DENIED);
    expect(viaFunction.data).toBeNull();
  });

  test("본인과 운영자는 user_status() 로 정지·우선권 시각을 읽는다", async () => {
    const [a, admin] = await Promise.all([createUser(), createAdmin()]);
    const suspendedAt = "2026-01-02T03:04:05+00:00";
    must(await service.from("user_stats").update({ suspended_at: suspendedAt }).eq("user_id", a.id));

    const own = await a.client.rpc("user_status", { p_user: a.id });
    const byAdmin = await admin.client.rpc("user_status", { p_user: a.id });

    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ user_id: a.id, suspended_at: suspendedAt, priority_since: null }]);
    expect(byAdmin.data).toEqual(own.data);
  });

  test("방문자는 user_stats 를 읽지 못하고 user_status() 도 부를 수 없다", async () => {
    const b = await createUser();

    const read = await visitor().from("user_stats").select("user_id").eq("user_id", b.id);
    const viaFunction = await visitor().rpc("user_status", { p_user: b.id });

    expect(read.data ?? []).toEqual([]);
    expect(read.error?.code).toBe(DENIED);
    expect(viaFunction.error?.code).toBe(DENIED);
  });

  test("A 는 자기 user_stats 도 고치거나 지우거나 새로 넣을 수 없다", async () => {
    const [a, fresh] = await Promise.all([createUser(), createUser()]);
    must(await service.from("user_stats").delete().eq("user_id", fresh.id));

    const update = await a.client.from("user_stats").update({ completed_count: 99 }).eq("user_id", a.id);
    const unsuspend = await a.client.from("user_stats").update({ suspended_at: null }).eq("user_id", a.id);
    const remove = await a.client.from("user_stats").delete().eq("user_id", a.id);
    const insert = await fresh.client.from("user_stats").insert({ user_id: fresh.id, completed_count: 99 });

    expect(update.error?.code).toBe(DENIED);
    expect(unsuspend.error?.code).toBe(DENIED);
    expect(remove.error?.code).toBe(DENIED);
    expect(insert.error?.code).toBe(DENIED);
    const rows = must(
      await service.from("user_stats").select("user_id, completed_count").in("user_id", [a.id, fresh.id]),
    );
    expect(rows).toEqual([{ user_id: a.id, completed_count: 0 }]);
  });
});

describe("R6 admins: 읽을 수 없고 자신을 운영자로 만들 수 없다", () => {
  test("A 는 admins 를 읽을 수 없다 (운영자가 실제로 있는 상태에서)", async () => {
    const [a, admin] = await Promise.all([createUser(), createAdmin()]);

    const { data, error } = await a.client.from("admins").select("user_id").eq("user_id", admin.id);

    expect(error?.code).toBe(DENIED);
    expect(data).toBeNull();
  });

  test("A 는 자신을 admins 에 넣을 수 없고 is_admin() 은 false 다", async () => {
    const a = await createUser();

    const insert = await a.client.from("admins").insert({ user_id: a.id });
    const isAdmin = await a.client.rpc("is_admin");

    expect(insert.error?.code).toBe(DENIED);
    expect(isAdmin.data).toBe(false);
    expect(must(await service.from("admins").select("user_id").eq("user_id", a.id))).toEqual([]);
  });

  test("운영자는 is_admin() 이 true 지만 admins 를 직접 고칠 수는 없다", async () => {
    const [admin, a] = await Promise.all([createAdmin(), createUser()]);

    const isAdmin = await admin.client.rpc("is_admin");
    const promote = await admin.client.from("admins").insert({ user_id: a.id });

    expect(isAdmin.data).toBe(true);
    expect(promote.error?.code).toBe(DENIED);
    expect(must(await service.from("admins").select("user_id").eq("user_id", a.id))).toEqual([]);
  });

  test("방문자는 admins 를 읽거나 쓸 수 없고 is_admin() 은 false 다", async () => {
    const admin = await createAdmin();

    const read = await visitor().from("admins").select("user_id");
    const insert = await visitor().from("admins").insert({ user_id: admin.id });
    const isAdmin = await visitor().rpc("is_admin");

    expect(read.error?.code).toBe(DENIED);
    expect(insert.error?.code).toBe(DENIED);
    expect(isAdmin.data).toBe(false);
  });
});

describe("R16 app_settings: 운영자만 고치고, 공개 키만 사용자에게 보인다", () => {
  async function seedSetting(isPublic: boolean) {
    const key = `test_${randomUUID()}`;
    must(
      await service
        .from("app_settings")
        .insert({ key, value: 1, description: "테스트용 키", is_public: isPublic }),
    );
    return key;
  }
  const readValue = async (key: string) =>
    must(await service.from("app_settings").select("value, is_public").eq("key", key).single());

  test("초기값 12개가 들어 있고 공개 키는 화면에 필요한 8개뿐이다", async () => {
    const rows = must(
      await service.from("app_settings").select("key, value, is_public").not("key", "like", "test_%"),
    );
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const publicKeys = rows.filter((r) => r.is_public).map((r) => r.key).sort();

    expect(settings).toEqual({
      respond_hours: 24,
      ship_warn_hours: 48,
      ship_dispute_hours: 72,
      auto_receive_days: 7,
      shipping_retention_days: 30,
      cycle3_min_completed: 3,
      cycle3_max_reports: 0,
      suspend_report_count: 2,
      terms_version: DOC_VERSION,
      privacy_version: DOC_VERSION,
      repropose_cooldown_days: 7,
      cycle3_candidates_per_set_max: 5000,
    });
    expect(publicKeys).toEqual([
      "auto_receive_days",
      "cycle3_min_completed",
      "privacy_version",
      "respond_hours",
      "ship_dispute_hours",
      "ship_warn_hours",
      "shipping_retention_days",
      "terms_version",
    ]);
  });

  test("A 는 공개 키를 읽고 비공개 키는 읽을 수 없다", async () => {
    const a = await createUser();
    const [publicKey, privateKey] = await Promise.all([seedSetting(true), seedSetting(false)]);

    const { data, error } = await a.client
      .from("app_settings")
      .select("key, value")
      .in("key", [publicKey, privateKey, "suspend_report_count", "terms_version"]);

    expect(error).toBeNull();
    expect(data?.map((r) => r.key).sort()).toEqual([publicKey, "terms_version"].sort());
  });

  test("운영자는 비공개 키도 읽는다", async () => {
    const admin = await createAdmin();
    const privateKey = await seedSetting(false);

    const { data } = await admin.client.from("app_settings").select("key").eq("key", privateKey);

    expect(data).toEqual([{ key: privateKey }]);
  });

  test("A 는 값을 고치거나 비공개 키를 공개로 바꾸거나 키를 넣고 지울 수 없다", async () => {
    const a = await createUser();
    const [publicKey, privateKey] = await Promise.all([seedSetting(true), seedSetting(false)]);

    const update = await a.client.from("app_settings").update({ value: 999 }).eq("key", publicKey).select();
    const expose = await a.client.from("app_settings").update({ is_public: true }).eq("key", privateKey);
    const insert = await a.client.from("app_settings").insert({ key: `test_${randomUUID()}`, value: 1, description: "x" });
    const remove = await a.client.from("app_settings").delete().eq("key", publicKey);

    expect(update.data ?? []).toEqual([]);
    expect(expose.error?.code).toBe(DENIED);
    expect(insert.error?.code).toBe(DENIED);
    expect(remove.error?.code).toBe(DENIED);
    expect(await readValue(publicKey)).toEqual({ value: 1, is_public: true });
    expect(await readValue(privateKey)).toEqual({ value: 1, is_public: false });
  });

  test("운영자는 값을 고칠 수 있지만 공개 여부는 바꿀 수 없다", async () => {
    const admin = await createAdmin();
    const privateKey = await seedSetting(false);

    const update = await admin.client.from("app_settings").update({ value: 36 }).eq("key", privateKey).select("key, value");
    const expose = await admin.client.from("app_settings").update({ is_public: true }).eq("key", privateKey);

    expect(update.error).toBeNull();
    expect(update.data).toEqual([{ key: privateKey, value: 36 }]);
    expect(expose.error?.code).toBe(DENIED);
    expect(await readValue(privateKey)).toEqual({ value: 36, is_public: false });
  });

  test("방문자는 공개 키도 읽지 못한다", async () => {
    const { data, error } = await visitor().from("app_settings").select("key");

    expect(error?.code).toBe(DENIED);
    expect(data).toBeNull();
  });
});

describe("profiles: 닉네임만 본인이 고친다", () => {
  test("A 는 B 의 닉네임과 문서 버전을 읽지만 동의 시각은 읽을 수 없다", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);

    const allowed = await a.client
      .from("profiles")
      .select("id, nickname, terms_version, privacy_version")
      .eq("id", b.id);
    expect(allowed.data).toEqual([
      { id: b.id, nickname: b.nickname, terms_version: DOC_VERSION, privacy_version: DOC_VERSION },
    ]);

    for (const columns of ["age_confirmed_at", "terms_agreed_at", "privacy_agreed_at", "*"]) {
      const { data, error } = await a.client.from("profiles").select(columns).eq("id", b.id);
      expect(error?.code, columns).toBe(DENIED);
      expect(data, columns).toBeNull();
    }
  });

  test("방문자는 profiles 를 읽지 못한다", async () => {
    const b = await createUser();

    const { data, error } = await visitor().from("profiles").select("id, nickname").eq("id", b.id);

    expect(error?.code).toBe(DENIED);
    expect(data).toBeNull();
  });

  test("A 는 자기 닉네임을 고칠 수 있다", async () => {
    const a = await createUser();
    const next = randomNickname();

    const { error } = await a.client.from("profiles").update({ nickname: next }).eq("id", a.id);

    expect(error).toBeNull();
    expect(must(await service.from("profiles").select("nickname").eq("id", a.id).single())).toEqual({ nickname: next });
  });

  test("A 는 B 의 닉네임을 고칠 수 없다", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);

    const { data } = await a.client.from("profiles").update({ nickname: randomNickname() }).eq("id", b.id).select("id");

    expect(data ?? []).toEqual([]);
    expect(must(await service.from("profiles").select("nickname").eq("id", b.id).single())).toEqual({ nickname: b.nickname });
  });

  test("A 는 자기 동의 시각과 문서 버전을 고칠 수 없고, 프로필을 지울 수 없다", async () => {
    const a = await createUser();
    const before = must(await service.from("profiles").select("*").eq("id", a.id).single());

    const version = await a.client.from("profiles").update({ terms_version: "가짜-버전" }).eq("id", a.id);
    const agreedAt = await a.client.from("profiles").update({ age_confirmed_at: "2000-01-01T00:00:00Z" }).eq("id", a.id);
    const remove = await a.client.from("profiles").delete().eq("id", a.id);

    expect(version.error?.code).toBe(DENIED);
    expect(agreedAt.error?.code).toBe(DENIED);
    expect(remove.error?.code).toBe(DENIED);
    expect(must(await service.from("profiles").select("*").eq("id", a.id).single())).toEqual(before);
  });

  test("가입만 한 사용자는 프로필을 직접 만들 수 없다 (동의 없이 프로필이 생기지 않는다)", async () => {
    const fresh = await createUser({ profile: false });
    const now = new Date().toISOString();

    const { error } = await fresh.client.from("profiles").insert({
      id: fresh.id,
      nickname: fresh.nickname,
      age_confirmed_at: now,
      terms_agreed_at: now,
      terms_version: DOC_VERSION,
      privacy_agreed_at: now,
      privacy_version: DOC_VERSION,
    });

    expect(error?.code).toBe(DENIED);
    expect(must(await service.from("profiles").select("id").eq("id", fresh.id))).toEqual([]);
  });

  test.each([
    ["한 글자", "가"],
    ["13자", "abcdefghijklm"],
    ["공백", "구양 이"],
    ["자모만", "ㄱㄴㄷ"],
    ["특수문자", "nick!"],
    ["하이픈", "nick-1"],
    ["이모지", "고양이🐾"],
  ])("닉네임 규칙 위반은 거부된다: %s", async (_label, nickname) => {
    const a = await createUser();

    const { error } = await a.client.from("profiles").update({ nickname }).eq("id", a.id);

    expect(error?.code).toBe("23514");
    expect(must(await service.from("profiles").select("nickname").eq("id", a.id).single())).toEqual({ nickname: a.nickname });
  });

  test.each([["한글 2자", "구양"], ["12자", "abcdefghijkl"], ["섞어 쓰기", "구양이_Cat9"]])(
    "닉네임 규칙에 맞으면 허용된다: %s",
    async (_label, base) => {
      const a = await createUser();
      // 다른 테스트 실행과 겹치지 않게, 규칙 안에서 고유한 값을 만든다
      const nickname = base === "구양" || base.length === 12 ? randomNicknameLike(base) : base + randomSuffix(1);

      const { error } = await a.client.from("profiles").update({ nickname }).eq("id", a.id);

      expect(error, nickname).toBeNull();
    },
  );

  test("대소문자만 다른 닉네임은 중복으로 거부된다", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);
    const taken = `Cat_${randomSuffix(6)}`;
    must(await service.from("profiles").update({ nickname: taken }).eq("id", b.id));

    const { error } = await a.client.from("profiles").update({ nickname: taken.toUpperCase() }).eq("id", a.id);

    expect(error?.code).toBe("23505");
  });
});

const HANGUL = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호";
const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
const randomSuffix = (n: number) => Array.from({ length: n }, () => pick("abcdefghijklmnopqrstuvwxyz0123456789")).join("");
/** 길이와 글자 종류는 base 와 같고 내용만 무작위인 닉네임 */
const randomNicknameLike = (base: string) =>
  Array.from(base, (ch) => (/[가-힣]/.test(ch) ? pick(HANGUL) : pick("abcdefghijklmnopqrstuvwxyz"))).join("");
