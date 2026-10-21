import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const out =
  process.env.QUOTEGUARD_OUTPUTS ||
  "../../outputs/browser";
async function api(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get("/api/auth/session/")).json();
  const r = await page.request.post("/api/" + path, {
    data,
    headers: { "X-CSRFToken": session.csrf },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function setup(page: Page) {
  await api(page, "auth/register/", {
    username: `refine_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    password: "SyntheticRefinement!2026",
  });
  const client = await api(page, "clients/", {
    name: "Synthetic Northstar",
    currency: "INR",
  });
  const records = [];
  for (const title of ["Zebra campaign", "Alpine identity", "Meadow website"]) {
    records.push(
      await api(page, "quotes/", {
        client: client.id,
        title,
        currency: "INR",
        valid_until: "2026-12-31",
        target_margin: ".3",
        fee_percent: "0",
        fixed_fee: "0",
        costs: [
          { description: "Synthetic work", quantity: "1", unit_cost: "1000" },
        ],
      }),
    );
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  return records;
}
test("discovery: client, currency, ID, sorting and recovery from no matches", async ({
  page,
}) => {
  const records = await setup(page);
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  const search = page.getByLabel("Search quotations");
  for (const query of ["  northSTAR  ", "INR"]) {
    await search.fill(query);
    await expect(page.locator(".quotation-table tbody tr")).toHaveCount(3);
  }
  await search.fill(`QG-${String(records[0].id).padStart(4, "0")}`);
  await expect(page.locator(".quotation-table tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Zebra campaign", exact: true }),
  ).toBeVisible();
  await search.fill("absent-project");
  await expect(
    page.getByRole("heading", { name: "No matching quotations" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset search and filters" }).click();
  await page.getByLabel("Sort quotations").selectOption("title");
  await expect(page.locator(".project-link")).toHaveText([
    "Alpine identity",
    "Meadow website",
    "Zebra campaign",
  ]);
  await page.getByLabel("Sort quotations").selectOption("recent");
  await expect(page.locator(".project-link")).toHaveText([
    "Meadow website",
    "Alpine identity",
    "Zebra campaign",
  ]);
  await page.getByLabel("Filter status").selectOption("finalised");
  await expect(
    page.getByRole("heading", { name: "No matching quotations" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Filter status")).toHaveValue("all");
});
test("command selection, no-result arrow keys, focus containment and restoration", async ({
  page,
}) => {
  await setup(page);
  const trigger = page.getByRole("button", { name: "Open quick search" });
  await trigger.click();
  const input = page.getByRole("combobox", { name: "Search workspace" });
  await expect(input).toBeFocused();
  await input.fill("nothing-here");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await input.fill("");
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { selected: true })).toContainText(
    "Quotations",
  );
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Quotations", exact: true }),
  ).toBeVisible();
  await trigger.click();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBeTruthy();
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
test("responsive cards, WCAG 2.2 scans, reduced motion and screenshots", async ({
  page,
}) => {
  fs.mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.screenshot({
    path: out + "/refined-dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  const scans = [];
  for (const width of [320, 390, 600, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    ).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Alpine identity", exact: true }),
    ).toBeVisible();
    if (width === 390 || width === 1440) {
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      scans.push({ width, violations: scan.violations });
      await page.screenshot({
        path: `${out}/refined-quotations-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "Open quick search" }).click();
  const modal = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  scans.push({ width: 1920, violations: modal.violations });
  fs.writeFileSync(
    out + "/refinement-accessibility.json",
    JSON.stringify({ scans, errors }, null, 2),
  );
  expect(scans.flatMap((s) => s.violations)).toEqual([]);
  expect(errors).toEqual([]);
});
test("dashboard continues a draft and directs attention to a below-target quote", async ({
  page,
}) => {
  const records = await setup(page);
  await page.getByRole("button", { name: "Continue latest draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Meadow website", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/auth/session/")).json();
  const q = records[0];
  const patch = await page.request.patch(`/api/quotes/${q.id}/`, {
    data: { version: q.version, proposed_price: "1" },
    headers: { "X-CSRFToken": session.csrf },
  });
  expect(patch.ok()).toBeTruthy();
  await api(page, `quotes/${q.id}/calculate/`, {});
  await page.reload();
  await page
    .getByRole("button", { name: "Review a margin", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Zebra campaign", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  await page.getByLabel("Filter status").selectOption("review");
  await expect(page.locator(".project-link")).toHaveText(["Zebra campaign"]);
});
test("password visibility is explicit and skip link reaches the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await setup(page);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-content")).toBeFocused();
});
