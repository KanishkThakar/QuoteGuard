import { test, expect } from "@playwright/test";
import fs from "node:fs";
const output =
  process.env.QUOTEGUARD_OUTPUTS ||
  "../../outputs/browser";
test("owner quotation workflow, cache experiments, frozen export and mobile", async ({
  page,
}) => {
  fs.mkdirSync(output, { recursive: true });
  const faults: string[] = [];
  page.on("pageerror", (e) => faults.push(e.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("demo");
  await page
    .getByLabel("Password", { exact: true })
    .fill("DemoQuoteGuard!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  await page.screenshot({
    path: output + "/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "Add client" }).click();
  const suffix = Date.now();
  const title = `Browser-verified project ${suffix}`;
  await page
    .getByLabel("Client name")
    .fill(`Synthetic browser client ${suffix}`);
  await page.getByLabel("Company").fill("Demonstration records only");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(page.getByRole("status")).toContainText("Client added");
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "New quotation" }).click();
  await page.getByLabel("Project title").fill(title);
  await page
    .getByLabel("Client", { exact: true })
    .selectOption({ label: `Synthetic browser client ${suffix}` });
  await page
    .getByLabel("Scope of work")
    .fill(
      "Design and implementation of a project website. Synthetic demonstration.",
    );
  await page
    .getByLabel("Client-facing notes")
    .fill("Synthetic demonstration: 50% on acceptance, 50% at handover.");
  await page.getByLabel("Unit cost 1", { exact: true }).fill("65000");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "The pricing breakdown" }),
  ).toBeVisible();
  await expect(page.getByText("₹65,000.00", { exact: true })).toBeVisible();
  const warmResponse = page.waitForResponse(
    (r) => r.url().includes("/calculate/") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  expect((await (await warmResponse).json()).calculation_cache).toBe("hit");
  await page.getByRole("button", { name: "Edit draft" }).click();
  await page.getByLabel("Unit cost 1", { exact: true }).fill("70000");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page
    .getByRole("button", { name: "Calculate price", exact: true })
    .click();
  await expect(page.getByText("₹70,000.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Review this price:", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh reference rate", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "The pricing breakdown" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Calculate price", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: output + "/quotation-detail.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Compare scenario", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "+10%", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finalise version" }).click();
  await expect(
    page.getByText(
      "Finalised snapshot. Future rate changes leave this version untouched.",
    ),
  ).toBeVisible();
  const pdfLink = page.getByRole("link", { name: "Client PDF" });
  const href = await pdfLink.getAttribute("href");
  const id = href!.match(/quotes\/(\d+)/)![1];
  const before = await page.request.get(`/api/quotes/${id}/`);
  const snapshot = (await before.json()).snapshot;
  const downloadPromise = page.waitForEvent("download");
  await pdfLink.click();
  const download = await downloadPromise;
  await download.saveAs(output + "/sample-client-quotation.pdf");
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Internal CSV" }).click();
  await (await csvPromise).saveAs(output + "/sample-internal-breakdown.csv");
  await page.getByRole("button", { name: "Cache Lab", exact: true }).click();
  await page.getByRole("button", { name: "Cold lookup" }).click();
  await expect(
    page.getByText("isolated cold miss", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Warm lookup" }).click();
  await expect(
    page.getByText("isolated warm hit", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh rate", exact: true }).click();
  await expect(page.getByText("refresh", { exact: true })).toBeVisible();
  const after = await page.request.get(`/api/quotes/${id}/`);
  expect((await after.json()).snapshot).toEqual(snapshot);
  await page.getByRole("button", { name: "Start 3s expiry" }).click();
  await expect(
    page.getByText("Demo key exists", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.getByRole("button", { name: "Inspect expiry" }).click();
        return await page
          .getByText("Demo key expired / missing", { exact: true })
          .isVisible();
      },
      { timeout: 7000, intervals: [1000] },
    )
    .toBe(true);
  await page.screenshot({ path: output + "/cache-lab.png", fullPage: true });
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Create revision" }).click();
  await expect(
    page.getByRole("heading", { name: "Refine your quotation." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Price with confidence." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: output + "/dashboard-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Quotations", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: title, exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: output + "/quotation-mobile.png",
    fullPage: true,
  });
  expect(faults).toEqual([]);
  fs.writeFileSync(
    output + "/browser-verification.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        quote_id: id,
        finalised_snapshot_unchanged: true,
        page_errors: faults,
        viewport_mobile: [390, 844],
        source:
          "Playwright workflow against the configured local app. Inspect rate provenance for live versus recorded provider mode.",
      },
      null,
      2,
    ),
  );
});
