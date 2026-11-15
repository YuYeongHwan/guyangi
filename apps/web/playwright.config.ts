import { defineConfig, devices } from "@playwright/test";

// E2E (docs/testing.md 3.7). 개발 서버가 아니라 빌드해서 띄운 앱에 대해 돌린다.
// 캐시가 실제로 동작하는 상태여야 E6~E8 이 의미가 있다.
const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // 모바일 우선. WebKit(iPhone) 프로젝트는 TASKS 3.12 에서 추가한다.
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // 이미 떠 있는 서버(개발 서버일 수 있다)를 재사용하지 않는다. 포트가 쓰이고 있으면 실패한다.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
