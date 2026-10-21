import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const output = process.env.QUOTEGUARD_OUTPUTS || "../../outputs/browser";
async function setup(page: Page) {
  const session = await (await page.request.get("/api/auth/session/")).json();
  const response = await page.request.post("/api/auth/register/", {data: {username: `topic6_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, password: "SyntheticTopicSix!2026"}, headers:{"X-CSRFToken":session.csrf}});
  expect(response.ok()).toBeTruthy();
  const auth = await response.json();
  const headers = {"X-CSRFToken":auth.csrf};
  const client = await (await page.request.post("/api/clients/", {data:{name:"Synthetic Topic 6 client",currency:"INR"},headers})).json();
  const quote = await (await page.request.post("/api/quotes/", {data:{client:client.id,title:"Topic 6 recovery draft",currency:"INR",valid_until:"2026-12-31",proposed_price:"2000",costs:[{description:"Synthetic source",quantity:"1",unit_cost:"1000"}]},headers})).json();
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Price with confidence."})).toBeVisible();
  return {quote,headers};
}

test("cache lifecycle shows actual results without invented missing timing",async({page})=>{
  await setup(page);fs.mkdirSync(output,{recursive:true});
  await page.getByRole("button",{name:"Cache Lab",exact:true}).click();
  await expect(page.getByRole("region",{name:"Cache experiment guide"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Calculation telemetry"}).locator("..")).toContainText("Not measured");
  await page.getByRole("button",{name:"Cold lookup",exact:true}).click();
  const observation=page.getByRole("status",{name:"Latest cache observation"});
  await expect(observation).toContainText("isolated cold miss");
  await page.screenshot({path:output+"/cache-cold.png",fullPage:true});
  await page.getByRole("button",{name:"Warm lookup",exact:true}).click();
  await expect(observation).toContainText("isolated warm hit");
  await page.screenshot({path:output+"/cache-warm.png",fullPage:true});
  await page.getByRole("button",{name:"Start 3s expiry",exact:true}).click();
  await expect(observation).toContainText("Not measured");
  await expect.poll(async()=>{
    await page.getByRole("button",{name:"Inspect expiry",exact:true}).click();
    return observation.textContent();
  },{timeout:7000,intervals:[500,1000]}).toContain("Expired or missing");
  await expect(observation).not.toContainText("-2 seconds");
  await page.screenshot({path:output+"/cache-expiry.png",fullPage:true});
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0,0); });
  await page.screenshot({path:output+"/cache-mobile.png",fullPage:false,animations:"disabled"});
});

test("409 exposes explicit reload and the next calculation succeeds",async({page})=>{
  const {quote}=await setup(page);
  await page.getByRole("button",{name:"Quotations",exact:false}).first().click();
  await page.getByRole("button",{name:quote.title,exact:true}).click();
  await page.route(`**/api/quotes/${quote.id}/calculate/`,route=>route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({detail:"Draft changed during calculation. Please retry."})}),{times:1});
  await page.getByRole("button",{name:"Calculate price",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  await page.getByRole("button",{name:"Reload latest draft",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Latest draft loaded");
  await page.getByRole("button",{name:"Calculate price",exact:true}).click();
  await expect(page.getByRole("heading",{name:"The pricing breakdown"})).toBeVisible();
  await page.screenshot({path:output+"/conflict-recovered.png",fullPage:true});
});

test("source editing shows stale state and recomputes through UI",async({page})=>{
  const {quote}=await setup(page);
  await page.getByRole("button",{name:"Quotations",exact:false}).first().click();
  await page.getByRole("button",{name:quote.title,exact:true}).click();
  await page.getByRole("button",{name:"Calculate price",exact:true}).click();
  await expect(page.getByRole("heading",{name:"The pricing breakdown"})).toBeVisible();
  await page.getByRole("button",{name:"Edit draft",exact:true}).click();
  await page.getByLabel("Unit cost 1",{exact:true}).fill("1500");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page.getByText("Draft inputs or reference rate changed.",{exact:false})).toBeVisible();
  await page.screenshot({path:output+"/source-changed-stale.png",fullPage:true});
  const response=page.waitForResponse(r=>r.url().endsWith(`/quotes/${quote.id}/calculate/`));
  await page.getByRole("button",{name:"Calculate price",exact:true}).click();
  const result=await (await response).json();
  expect(result.cost).toBe("1500.00");expect(result.calculation_cache).toBe("miss");
  await expect(page.getByRole("heading",{name:"The pricing breakdown"})).toBeVisible();
  await page.screenshot({path:output+"/source-recalculated.png",fullPage:true});
});

test("interactive replay shows source invalidation and a fixed finalised snapshot", async ({page}) => {
  const {quote,headers} = await setup(page);
  const finalise = await page.request.post(`/api/quotes/${quote.id}/finalise/`, {data:{},headers});
  expect(finalise.ok()).toBeTruthy();
  const revision = await page.request.post(`/api/quotes/${quote.id}/duplicate/`, {data:{},headers});
  expect(revision.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button",{name:"Cache Lab",exact:true}).click();
  const replay = page.getByRole("region",{name:"Interactive cache replay"});
  await replay.getByRole("button",{name:"Pin finalised snapshot"}).click();
  await expect(replay).toContainText("Baseline captured");
  await replay.getByRole("button",{name:"Run real request"}).click();
  await expect(replay.getByRole("status")).toContainText("completed: miss");
  await replay.getByRole("button",{name:"Run real request"}).click();
  await expect(replay.getByRole("status")).toContainText("completed: hit");
  await replay.getByLabel("New first-item unit cost").fill("1500");
  await replay.getByRole("button",{name:"Save cost & advance version"}).click();
  await expect(replay.getByRole("status")).toContainText("input version 1 → 2");
  await replay.getByRole("button",{name:"Run real request"}).click();
  await expect(replay.getByRole("status")).toContainText("completed: miss");
  await replay.getByRole("button",{name:"04 Provider / calculation"}).click();
  await expect(replay).toContainText("External provider called: no. Pricing calculation executed: yes.");
  await replay.getByRole("button",{name:"Run real request"}).click();
  await expect(replay.getByRole("status")).toContainText("completed: hit");
  await replay.getByRole("button",{name:"Verify frozen snapshot"}).click();
  await expect(replay).toContainText("Verified unchanged: full snapshot SHA-256 matches.");
  await replay.getByText("Actual request history (4)",{exact:true}).click();
  await expect(replay.getByRole("listitem")).toHaveCount(4);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:output+"/interactive-replay.png",fullPage:true});
});
