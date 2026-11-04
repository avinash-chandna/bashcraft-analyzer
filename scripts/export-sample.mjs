/**
 * Recreate the documented sample exports from a saved report.
 *
 * Usage:
 *   npm run build
 *   PORT=8790 npm start
 *   node scripts/export-sample.mjs [report.json] [app-url] [output-dir]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const reportPath =
  process.argv[2] || "docs/sample-output/bashcraftclub.vercel.app-2026-11-04.json";
const appUrl = process.argv[3] || "http://127.0.0.1:8790/";
const outDir = path.resolve(process.argv[4] || "docs/sample-output");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const baseName = "bashcraftclub.vercel.app-2026-11-04";

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

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

await page.goto(appUrl, { waitUntil: "networkidle" });
await page.locator(".button--scan").click();
await page.locator(".results-title-row h1").waitFor({ timeout: 30_000 });
await page.getByRole("tab", { name: /EXPORT/ }).click();
await page.locator(".export-grid").waitFor();

const artifacts = [
  { selector: ".export-card__button", index: 0, file: `${baseName}.json` },
  { selector: ".export-card__button", index: 1, file: `${baseName}-pages.csv` },
  { selector: ".export-card__button", index: 2, file: `${baseName}-broken-links.csv` },
  { selector: ".export-card__button", index: 3, file: `${baseName}-sitemap.xml` },
  { selector: ".export-extra button", index: 0, file: `${baseName}-internal-links.csv` },
];

for (const artifact of artifacts) {
  const button = page.locator(artifact.selector).nth(artifact.index);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button.click(),
  ]);
  await download.saveAs(path.join(outDir, artifact.file));
  const stats = fs.statSync(path.join(outDir, artifact.file));
  console.log(`${artifact.file} (${stats.size} bytes)`);
}

await context.close();
await browser.close();
