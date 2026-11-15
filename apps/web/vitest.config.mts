import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 웹 단위 테스트 (docs/testing.md 2장). 소스 옆 *.test.ts(x) 만 돌린다.
// E2E(e2e/*.spec.ts)는 Playwright 가, DB 통합(supabase/tests)은 pnpm test:db 가 맡는다.
export default defineConfig({
  plugins: [react()],
  // vite-tsconfig-paths 플러그인 대신 Vite 내장 기능을 쓴다 (tsconfig 의 "@/*")
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    allowOnly: false,
  },
});
