import { execFileSync } from "node:child_process";

import { defineConfig } from "vitest/config";

// DB 통합 테스트 (docs/testing.md 2장). 로컬 Supabase(진짜 Postgres)에 대해 돌린다.
// 접속 정보는 저장소에 두지 않고 실행할 때 `supabase status` 에서 읽는다 (ADR-0003: 공개 저장소).
function readLocalSupabase(): Record<string, string> {
  let out: string;
  try {
    out = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "로컬 Supabase 가 떠 있지 않아요. 먼저 `supabase start` 를 실행하세요 (Docker 필요).",
    );
  }
  const env = Object.fromEntries(
    [...out.matchAll(/^([A-Z0-9_]+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]),
  );
  if (!env.API_URL || !env.ANON_KEY) {
    throw new Error("`supabase status -o env` 에서 API_URL, ANON_KEY 를 읽지 못했어요.");
  }
  return env;
}

const local = readLocalSupabase();

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    allowOnly: false,
    env: {
      SUPABASE_URL: local.API_URL,
      SUPABASE_ANON_KEY: local.ANON_KEY,
    },
  },
});
