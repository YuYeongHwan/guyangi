import { expect, test } from "@playwright/test";

// 러너 확인용 (TASKS 1.6). 빌드해서 띄운 앱을 모바일 뷰포트로 연다.
test("모바일 화면에서 첫 화면을 열면 '구양이' 제목이 보인다", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "구양이" }),
  ).toBeVisible();
  // 모바일 뷰포트로 돌고 있는지 (Pixel 7: 가로 412)
  expect(page.viewportSize()?.width).toBeLessThan(500);
});
