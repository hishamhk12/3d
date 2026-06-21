import { chromium } from "@playwright/test";

const out = process.argv[2] || "room-preview.png";
const width = Number(process.argv[3] || 1080);
const height = Number(process.argv[4] || 1920);
const url = process.env.SHOT_URL || "http://localhost:3000/room-preview";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500); // let coverflow settle / images decode
await page.screenshot({ path: out });
const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
console.log(`shot ${out} @ ${width}x${height} | scroll ${scrollW}x${scrollH}`);
await browser.close();
