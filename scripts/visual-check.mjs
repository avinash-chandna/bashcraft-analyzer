import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const reportPath =
  process.argv[2] ||
  path.join(
    process.env.TEMP || ".",
    "opencode-browser-Cu72LU",
    "0",
    "bashcraftclub.vercel.app-2026-11-04-13-38-04.json",
  );
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const outDir = path.resolve("screenshots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const results = {};

async function makePage(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      body: `${JSON.stringify({ type: "accepted" })}\n${JSON.stringify({
        type: "complete",
        data: report,
      })}\n`,
    }),
  );
  return { context, page };
}

async function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.right > width + 1)
      .slice(0, 8)
      .map(({ el, rect }) => ({
        tag: el.tagName,
        className: typeof el.className === "string" ? el.className : el.className?.baseVal,
        right: Math.round(rect.right),
      }));
    return {
      clientWidth: width,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
    };
  });
}

// Desktop ---------------------------------------------------------------
{
  const { context, page } = await makePage(1440, 1000);
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, "landing-desktop.png"), fullPage: true });
  results.landingDesktop = await overflow(page);

  await page.locator(".header-link", { hasText: "METHOD" }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, "method-modal.png") });
  await page.keyboard.press("Escape");

  await page.locator(".button--scan").click();
  await page.locator(".results-title-row h1").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, "report-desktop.png"), fullPage: true });
  results.reportDesktop = await overflow(page);

  await page.getByRole("tab", { name: /PAGES/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "pages-desktop.png"), fullPage: true });
  results.pagesDesktop = await overflow(page);

  await page.getByRole("tab", { name: /LINKS/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "links-desktop.png"), fullPage: true });
  results.linksDesktop = await overflow(page);

  await page.getByRole("tab", { name: /EXPORT/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "export-desktop.png"), fullPage: true });
  results.exportDesktop = await overflow(page);
  await context.close();
}

// Mobile ---------------------------------------------------------------
{
  const { context, page } = await makePage(390, 844);
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, "landing-mobile.png"), fullPage: true });
  results.landingMobile = await overflow(page);

  await page.locator(".button--scan").click();
  await page.locator(".results-title-row h1").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, "report-mobile.png"), fullPage: true });
  results.reportMobile = await overflow(page);

  await page.getByRole("tab", { name: /LINKS/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "links-mobile.png"), fullPage: true });
  results.linksMobile = await overflow(page);
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ errors, results }, null, 2));
