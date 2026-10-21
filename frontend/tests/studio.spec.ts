import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const out =
  process.env.QUOTEGUARD_OUTPUTS ||
  "../../outputs/browser";
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
    currency: "INR",
  });
  const quote = await api(page, "quotes/", "POST", {
    client: c.id,
    title: "Synthetic Brand Experience",
    valid_until: "2026-12-31",
    currency: "INR",
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
test("keyboard search, empty results, client editing and frozen client details", async ({
  page,
}) => {
  const { c, q } = await workspace(page);
  await api(page, `quotes/${q.id}/finalise/`, "POST", {});
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Jump anywhere" }),
  ).toBeVisible();
  await page.getByLabel("Search workspace").fill("not-present-anywhere");
  await expect(page.getByText("No results.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Open quick search" }).click();
  await page.getByLabel("Search workspace").fill(c.name);
  await page
    .getByRole("dialog")
    .getByRole("option", { name: new RegExp("^" + c.name) })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit client", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Synthetic Northstar Rebrand");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Client updated");
  const frozen = await api(page, `quotes/${q.id}/`);
  expect(frozen.client_name).toBe(c.name);
  expect(frozen.client_details.name).toBe(c.name);
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit client Synthetic Northstar Rebrand" })
    .click();
  await expect(page.getByLabel("Client name", { exact: true })).toHaveValue(
    "Synthetic Northstar Rebrand",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
test("margin preview is read-only, applied draft is recalculated and frozen preview stays frozen", async ({
  page,
}) => {
  const { q } = await workspace(page);
  await openQuote(page, q.title);
  await page.getByLabel("Planned target margin").fill("40");
  await page
    .getByRole("button", { name: "Preview target price", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Margin planner" }).getByRole("status"),
  ).toContainText("₹1,666.67");
  expect((await api(page, `quotes/${q.id}/`)).version).toBe(q.version);
  await page
    .getByRole("button", { name: "Use this price in draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Planned target and price applied",
  );
  const current = await api(page, `quotes/${q.id}/`);
  expect(Number(current.target_margin)).toBe(0.4);
  expect(Number(current.proposed_price)).toBe(1666.67);
  expect(current.calculation_stale).toBe(false);
  expect(Number(current.last_calculation.margin)).toBeGreaterThanOrEqual(0.4);
  await page
    .getByRole("button", { name: "Finalise version", exact: true })
    .click();
  await expect(
    page.getByText(
      "Finalised snapshot. Future rate changes leave this version untouched.",
    ),
  ).toBeVisible();
  const frozen = await api(page, `quotes/${q.id}/`);
  await page.getByLabel("Planned target margin").fill("50");
  await page
    .getByRole("button", { name: "Preview target price", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Margin planner" }).getByRole("status"),
  ).toContainText("₹2,000.00");
  await expect(
    page.getByRole("button", { name: "Use this price in draft", exact: true }),
  ).toHaveCount(0);
  expect((await api(page, `quotes/${q.id}/`)).snapshot).toEqual(
    frozen.snapshot,
  );
});
test("portfolio totals, studio screenshots, responsive layout and accessibility including modal and planner", async ({
  page,
}) => {
  fs.mkdirSync(out, { recursive: true });
  const faults: string[] = [];
  page.on("pageerror", (e) => faults.push(e.message));
  const { c, q } = await workspace(page);
  await api(page, `quotes/${q.id}/finalise/`, "POST", {});
  await page.reload();
  const portfolio = page.getByRole("region", { name: "Portfolio insights" });
  await expect(portfolio).toContainText("₹1,333.34");
  await expect(portfolio).toContainText("₹333.34");
  const scans: any[] = [];
  const scan = async (screen: string) => {
    scans.push({
      screen,
      violations: (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    });
  };
  await scan("dashboard");
  await page.screenshot({
    path: out + "/studio-dashboard.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `dashboard ${width}`,
    ).toBeTruthy();
  }
  const mobileContext = await page
    .context()
    .browser()!
    .newContext({
      viewport: { width: 390, height: 844 },
      storageState: await page.context().storageState(),
      reducedMotion: "reduce",
    });
  const mobile = await mobileContext.newPage();
  await mobile.goto(process.env.QUOTEGUARD_BASE_URL || "http://127.0.0.1:8780/");
  await expect(
    mobile.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  await mobile.screenshot({
    path: out + "/studio-mobile.png",
    fullPage: false,
  });
  await mobileContext.close();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Open quick search" }).click();
  await scan("quick search");
  await page.screenshot({ path: out + "/studio-search.png", fullPage: true });
  await page.keyboard.press("Escape");
  await openQuote(page, q.title);
  await page.getByLabel("Planned target margin").fill("40");
  await page.getByRole("button", { name: "Preview target price" }).click();
  await expect(
    page.getByRole("region", { name: "Margin planner" }).getByRole("status"),
  ).toBeVisible();
  await scan("planner result");
  await page.screenshot({ path: out + "/studio-planner.png", fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `planner ${width}`,
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: `Edit client ${c.name}` }).click();
  await scan("client editor");
  fs.writeFileSync(
    out + "/studio-accessibility.json",
    JSON.stringify({ scans, page_errors: faults }, null, 2),
  );
  expect(
    scans
      .flatMap((s) => s.violations)
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n: any) => n.target) })),
  ).toEqual([]);
  expect(faults).toEqual([]);
});
