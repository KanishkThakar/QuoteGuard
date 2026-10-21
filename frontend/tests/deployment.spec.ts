import { test, expect } from "@playwright/test";

test("one-click demo opens a real session and logout protects the workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(page.getByRole("heading", { name: "Price with confidence." })).toBeVisible();
  const session = await (await page.request.get("/api/auth/session/")).json();
  expect(session.user.username).toBe("demo");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Price with confidence." })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Explore demo workspace" })).toBeVisible();
  expect((await page.request.get("/api/quotes/")).status()).toBe(403);
});
