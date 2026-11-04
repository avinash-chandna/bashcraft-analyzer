/**
 * End-to-end UI check for broken-link reporting against the local fixture.
 *
 * Terminal 1: node scripts/fixture-site.mjs
 * Terminal 2: ALLOW_PRIVATE_HOSTS=true PORT=8790 npm start
 * Terminal 3: node scripts/verify-broken-ui.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const appUrl = process.env.APP_URL || "http://127.0.0.1:8790/";
const fixtureUrl = process.env.FIXTURE_URL || "http://127.0.0.1:8899/";
const tripwireUrl = process.env.TRIPWIRE_URL || "http://127.0.0.1:8898/__hits";
const outDir = path.resolve("screenshots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.locator(".url-field input").fill(fixtureUrl);
  await page.locator(".button--scan").click();

  await page.locator(".results-title-row h1").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);

  const summary = await page.locator(".summary-grid").innerText();
  console.log("summary\n" + summary);

  await page.getByRole("tab", { name: /LINKS/ }).click();
  await page.locator(".links-card").waitFor();
  const brokenCards = page.locator(".broken-card");
  const brokenCount = await brokenCards.count();
  const brokenText = await page.locator(".broken-grid").innerText();
  console.log("broken targets shown:", brokenCount);
  console.log(brokenText);

  if (brokenCount !== 2) throw new Error(`Expected 2 broken targets, found ${brokenCount}`);
  if (!brokenText.includes("/missing")) throw new Error("Missing 404 target");
  if (!brokenText.includes("/soft-404")) throw new Error("Missing soft-404 target");
  if (!/not-found/i.test(brokenText)) throw new Error("Soft-404 reason was not explained");

  await page.screenshot({
    path: path.join(outDir, "broken-links-desktop.png"),
    fullPage: true,
  });

  await page.getByRole("tab", { name: /PAGES/ }).click();
  await page.waitForTimeout(300);
  const pagesText = await page.locator(".data-table").innerText();
  for (const expected of ["ABOUT", "JS-PAGE", "LONG-TITLE", "UNTITLED"]) {
    if (!pagesText.includes(expected)) throw new Error(`Pages view is missing ${expected}`);
  }
  console.log("pages view includes about, js-generated, long-title, and untitled pages");

  await page.getByRole("tab", { name: /LINKS/ }).click();
  await page.locator(".link-tabs").getByRole("tab", { name: /EXTERNAL/ }).click();
  const externalText = await page.locator(".links-card").innerText();
  if (!externalText.includes("127.0.0.1:8898")) throw new Error("Tripwire external link missing");
  if (!externalText.includes("example.com")) throw new Error("Example external link missing");
  if (!externalText.includes("NOT REQUESTED")) throw new Error("External request policy note missing");
  console.log("external destinations are catalogued and labelled NOT REQUESTED");

  const hits = await (await fetch(tripwireUrl)).json();
  if (hits.hits !== 0) throw new Error(`External tripwire was requested ${hits.hits} time(s)`);
  console.log("external tripwire hits:", hits.hits);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  if (scrollWidth > clientWidth + 1) {
    throw new Error(`Horizontal overflow: ${scrollWidth} > ${clientWidth}`);
  }

  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log("UI check passed");
} finally {
  await context.close();
  await browser.close();
}
