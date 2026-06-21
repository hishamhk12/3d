import { chromium } from "@playwright/test";

const out = process.argv[2] || "screen-launcher.png";
const width = Number(process.argv[3] || 1080);
const height = Number(process.argv[4] || 1920);
const url =
  "http://localhost:3000/room-preview/screen?source=hero_try_button";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
// Capture the transition state before the ~2s redirect to the QR screen.
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1100);
await page.screenshot({ path: out });
const url2 = page.url();
console.log(`shot ${out} @ ${width}x${height} | url=${url2}`);
await browser.close();
