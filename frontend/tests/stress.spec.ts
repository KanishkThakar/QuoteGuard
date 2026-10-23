import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const out = process.env.QUOTEGUARD_OUTPUTS || "../../outputs/browser";
async function api(page: Page, path: string, method = "GET", data?: any) {
  const session = await (await page.request.get("/api/auth/session/")).json();
  const r = await page.request.fetch("/api/" + path, {
    method,
    data,
    headers: { "X-CSRFToken": session.csrf },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function workspace(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await api(page, "auth/register/", "POST", {
    username: "studioqa_" + Date.now(),
    password: "SyntheticStudio!2026",
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  const c = await api(page, "clients/", "POST", {
    name: "Synthetic Northstar Studio",
    company: "Synthetic design client",
    email: "synthetic@example.com",
    currency: "USD",
  });
  const quote = await api(page, "quotes/", "POST", {
    client: c.id,
    title: "Synthetic Brand Experience",
    valid_until: "2026-12-31",
    currency: "USD",
    target_margin: ".25",
    fee_percent: "0",
    fixed_fee: "0",
    costs: [
      {
        description: "Synthetic design work",
        quantity: "1",
        unit_cost: "1000",
      },
    ],
  });
  await api(page, `quotes/${quote.id}/calculate/`, "POST", {});
  await page.reload();
  return { c, q: await api(page, `quotes/${quote.id}/`) };
}
async function openQuote(page: Page, title: string) {
  await page
    .getByRole("button", { name: "Open quick search", exact: true })
    .click();
  await page.getByLabel("Search workspace").fill(title);
  await page.getByLabel("Search workspace").press("Enter");
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
test("deal stress previews real cache, recovery, frozen data and narrow layouts", async ({
  page,
}) => {
  const { q } = await workspace(page);
  await openQuote(page, q.title);
  const desk = page.getByRole("region", { name: "Deal stress test" });
  await desk
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(
    desk.getByText("Margin protected", { exact: true }),
  ).toBeVisible();
  await expect(desk.locator("summary")).toContainText("Redis MISS");
  await desk
    .getByRole("button", { name: "Run again · check cache", exact: true })
    .click();
  await expect(desk.locator("summary")).toContainText("Redis HIT");
  await desk.getByLabel("Client discount", { exact: true }).fill("30");
  await desk.getByLabel("Cost increase", { exact: true }).fill("20");
  await desk.getByLabel("Exchange-rate change", { exact: true }).fill("10");
  await expect(
    desk.getByText("Margin protected", { exact: true }),
  ).not.toBeVisible();
  await desk
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(
    desk.getByText("Deal not viable", { exact: true }),
  ).toBeVisible();
  await expect(desk.getByText("Two ways back to your target")).toBeVisible();
  expect((await api(page, `quotes/${q.id}/`)).version).toBe(q.version);
  const axe = (await import("@axe-core/playwright")).default;
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    const audit = await new axe({ page })
      .include(".deal-stress")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
  await desk.scrollIntoViewIfNeeded();
  await desk.screenshot({
    path: process.env.QUOTEGUARD_OUTPUTS + "/deal-stress-desktop.png",
  });
  await api(page, `quotes/${q.id}/finalise/`, "POST", {});
  const frozen = await api(page, `quotes/${q.id}/`);
  await page.reload();
  await openQuote(page, q.title);
  await desk
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(
    desk.getByText("Margin protected", { exact: true }),
  ).toBeVisible();
  expect((await api(page, `quotes/${q.id}/`)).snapshot).toEqual(
    frozen.snapshot,
  );
});
