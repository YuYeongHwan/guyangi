import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// DB 통합 테스트 도구 (docs/testing.md 3.3, 4장).
// - 검증은 항상 "그 사용자의 클라이언트" 로 한다. service 는 준비와 결과 대조에만 쓴다.
// - 테스트마다 사용자를 새로 만든다. 공용 사용자를 쓰지 않는다.
// - 이메일과 닉네임은 누가 봐도 가짜인 값만 쓴다 (저장소가 공개다).
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

export const DOC_VERSION = "2026-11-draft";

/** RLS 를 우회한다. 준비와 결과 대조 전용. */
export const service = createClient(url, serviceKey, options);

/** 로그인하지 않은 방문자 */
export const visitor = (): SupabaseClient => createClient(url, anonKey, options);

/** service 호출이 실패하면 테스트 준비가 잘못된 것이므로 바로 던진다 */
export function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`테스트 준비 실패: ${result.error.message}`);
  return result.data;
}

export const randomNickname = () => `t_${randomUUID().replaceAll("-", "").slice(0, 10)}`;

export type TestUser = { client: SupabaseClient; id: string; nickname: string };

/** 실제로 가입한 사용자. profile: false 면 가입만 하고 프로필은 만들지 않는다 */
export async function createUser({ profile = true } = {}): Promise<TestUser> {
  const client = createClient(url, anonKey, options);
  const { data, error } = await client.auth.signUp({
    email: `u-${randomUUID()}@example.test`,
    password: randomUUID(),
  });
  if (error || !data.user || !data.session) {
    throw new Error(`테스트 사용자 가입 실패: ${error?.message ?? "세션 없음"}`);
  }
  const id = data.user.id;
  const nickname = randomNickname();
  if (profile) {
    const now = new Date().toISOString();
    // create_profile 함수는 TASKS 2.6 에서 만든다. 그때까지는 service 로 직접 넣는다.
    must(
      await service.from("profiles").insert({
        id,
        nickname,
        age_confirmed_at: now,
        terms_agreed_at: now,
        terms_version: DOC_VERSION,
        privacy_agreed_at: now,
        privacy_version: DOC_VERSION,
      }),
    );
    must(await service.from("user_stats").insert({ user_id: id }));
  }
  return { client, id, nickname };
}

export async function createAdmin(): Promise<TestUser> {
  const admin = await createUser();
  must(await service.from("admins").insert({ user_id: admin.id }));
  return admin;
}
