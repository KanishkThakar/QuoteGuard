import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const output =
  process.env.QUOTEGUARD_OUTPUTS ||
  "../../outputs/browser";
async function login(
  page: Page,
  username = "demo",
  password = "DemoQuoteGuard!2026",
) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
}
async function request(page: Page, path: string, method = "GET", data?: any) {
  const session = await (await page.request.get("/api/auth/session/")).json();
  const response = await page.request.fetch("/api/" + path, {
    method,
    data,
    headers: { "X-CSRFToken": session.csrf },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function quote(page: Page) {
  const client = await request(page, "clients/", "POST", {
    name: "Synthetic QA client " + Date.now(),
    currency: "INR",
  });
  return request(page, "quotes/", "POST", {
    client: client.id,
    title: "Synthetic deep QA " + Date.now(),
    currency: "INR",
    valid_until: "2026-12-01",
    target_margin: "0.30",
    fee_percent: "0",
    fixed_fee: "0",
    costs: [{ description: "Synthetic work", quantity: "1", unit_cost: "100" }],
  });
}
async function open(page: Page, q: any) {
  await page.reload();
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: q.title, exact: true }).click();
}
test("new quotation cancellation and account switching clear owner data", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New quotation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to quotation", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Quotations" })).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("demo_other");
  await page
    .getByLabel("Password", { exact: true })
    .fill("DemoQuoteGuard!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic browser client", { exact: false }),
  ).toHaveCount(0);
  const rows = await request(page, "quotes/");
  expect(
    rows.every((q: any) => !q.title.startsWith("Browser-verified")),
  ).toBeTruthy();
});
test("stale prices, conflicting editor save, cancellation recovery and scenarios", async ({
  page,
}) => {
  await login(page);
  const q = await quote(page);
  await request(page, `quotes/${q.id}/calculate/`, "POST", {});
  await open(page, q);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Unit cost 1", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft inputs or reference rate changed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The pricing breakdown" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  await expect(page.getByText("₹200.00", { exact: true })).toBeVisible();
  await page.getByLabel("Custom scenario change").fill("-100");
  await page
    .getByRole("button", { name: "Compare scenario", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("change_percent");
  await page.getByLabel("Custom scenario change").fill("2.125");
  await page
    .getByRole("button", { name: "Compare scenario", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "+2.125%", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const current = await request(page, `quotes/${q.id}/`);
  await request(page, `quotes/${q.id}/`, "PATCH", {
    version: current.version,
    title: q.title + " updated elsewhere",
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed");
  await page
    .getByRole("button", { name: "Back to quotation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: q.title + " updated elsewhere" }),
  ).toBeVisible();
});
test("non-JSON server failure is recoverable and never crashes the page", async ({
  page,
}) => {
  await login(page);
  const q = await quote(page);
  await open(page, q);
  await page.route(`**/api/quotes/${q.id}/calculate/`, (r) =>
    r.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<h1>Proxy unavailable</h1>",
    }),
  );
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("server is unavailable");
  await page.unroute(`**/api/quotes/${q.id}/calculate/`);
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "The pricing breakdown" }),
  ).toBeVisible();
});
test("registration, invalid login, empty workspace and duplicate username", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("nonexistent-qa");
  await page.getByLabel("Password", { exact: true }).fill("incorrect!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  const user = "qa_" + Date.now();
  await page.getByLabel("Username", { exact: true }).fill(user);
  await page.getByLabel("Password", { exact: true }).fill("SyntheticQa!2026");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  expect(await request(page, "quotes/")).toEqual([]);
  await page
    .getByRole("button", { name: "New quotation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Add a client" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(user);
  await page.getByLabel("Password", { exact: true }).fill("SyntheticQa!2026");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("already exists");
});
test("accessibility and responsive layout across workspace screens", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const results: any[] = [];
  const layout: any[] = [];
  await page.goto("/");
  results.push({
    screen: "login",
    ...(await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()),
  });
  await login(page);
  for (const name of ["Dashboard", "Clients", "Quotations", "Cache Lab"]) {
    await page.getByRole("button", { name, exact: false }).first().click();
    await page.waitForTimeout(150);
    results.push({
      screen: name,
      ...(await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()),
    });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      layout.push({
        name,
        width,
        pageFits: await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        overflow: await page.evaluate(() =>
          Array.from(document.querySelectorAll("*"))
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
            .map((el) => ({
              tag: el.tagName,
              cls: el.className,
              width: el.getBoundingClientRect().width,
              text: el.textContent?.slice(0, 60),
            })),
        ),
      });
    }
  }
  const q = await quote(page);
  await request(page, `quotes/${q.id}/calculate/`, "POST", {});
  await open(page, q);
  for (const screen of ["quotation detail", "editor"]) {
    if (screen === "editor")
      await page
        .getByRole("button", { name: "Edit draft", exact: true })
        .click();
    results.push({
      screen,
      ...(await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()),
    });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      layout.push({
        name: screen,
        width,
        pageFits: await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      });
    }
  }
  fs.writeFileSync(
    output + "/responsive-diagnostics.json",
    JSON.stringify(layout, null, 2),
  );
  expect(layout.filter((r) => !r.pageFits)).toEqual([]);
  fs.writeFileSync(
    output + "/accessibility-results.json",
    JSON.stringify(
      results.map((r) => ({ screen: r.screen, violations: r.violations })),
      null,
      2,
    ),
  );
  expect(
    results
      .flatMap((r) => r.violations)
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n: any) => n.target) })),
  ).toEqual([]);
});

test("zero revenue, archive filtering, search and revision recovery", async ({
  page,
}) => {
  await login(page);
  const q = await quote(page);
  const current = await request(page, `quotes/${q.id}/`);
  await request(page, `quotes/${q.id}/`, "PATCH", {
    version: current.version,
    proposed_price: "0",
  });
  await open(page, q);
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  await expect(
    page.getByText("Undefined", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Review this price:", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByText("Draft archived.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "All quotations", exact: true })
    .click();
  await page.getByLabel("Filter status").selectOption("archived");
  await page.getByLabel("Search quotations").fill(q.title);
  await page.getByRole("button", { name: q.title, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Calculate price", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create revision", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Refine your quotation." }),
  ).toBeVisible();
});
