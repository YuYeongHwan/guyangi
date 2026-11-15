import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";

// 러너 확인용 (TASKS 1.6). 로컬 Supabase 에 실제로 연결한다. 모킹하지 않는다 (docs/testing.md 1장 4번).
// 접속 정보는 vitest.config.mts 가 `supabase status` 에서 읽어 넣는다.
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

test("로컬 Supabase 에 이메일·비밀번호로 가입하고, 그 세션으로 Auth 와 PostgREST 가 응답한다", async () => {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  // 테스트마다 새 사용자 (docs/testing.md 4장). 누가 봐도 가짜인 주소만 쓴다.
  const email = `smoke-${randomUUID()}@example.test`;

  const signUp = await client.auth.signUp({ email, password: randomUUID() });
  expect(signUp.error).toBeNull();
  expect(signUp.data.session).not.toBeNull();

  // Auth: 방금 받은 토큰을 서버가 검증해 같은 사용자를 돌려준다
  const me = await client.auth.getUser();
  expect(me.data.user?.email).toBe(email);

  // PostgREST: 아직 테이블이 없으므로 "없는 테이블" 오류가 PostgREST 에서 와야 한다
  const rest = await client.from("_no_such_table").select();
  expect(rest.status).toBe(404);
  expect(rest.error?.code).toBe("PGRST205");
});
