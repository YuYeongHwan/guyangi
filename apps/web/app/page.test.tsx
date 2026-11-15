import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "./page";

test("첫 화면에 서비스 이름 '구양이' 가 제목으로 보인다", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { level: 1, name: "구양이" }),
  ).toBeDefined();
});
