import { expect, test } from "@playwright/test";

test("dashboard renders", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("EDINET Screening Studio")).toBeVisible();
  await expect(page.getByRole("button", { name: "収集を再開" })).toBeVisible();
});
