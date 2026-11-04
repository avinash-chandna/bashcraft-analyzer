import { chromium } from "playwright";

const url = "https://bashcraftclub.vercel.app/__craftscope_missing_route__";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
await page.waitForTimeout(900);

const evidence = await page.evaluate(() => {
  const text = document.body.innerText.replace(/\s+/g, " ").trim();
  return {
    title: document.title,
    h1: document.querySelector("h1")?.innerText.replace(/\s+/g, " ").trim() || "",
    hasMarker: text.includes("RESOURCE_NOT_FOUND"),
    hasVoidPhrase: text.includes("THE VOID CLAIMS THIS LINK"),
    bodyExcerpt: text.slice(0, 320),
  };
});

await page.screenshot({ path: "screenshots/bashcraft-soft404.png", fullPage: true });
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
