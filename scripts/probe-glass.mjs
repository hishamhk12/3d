import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto("http://localhost:3000/room-preview/screen?source=hero_try_button", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(1100);
const r = await page.$eval(".qr-glass-panel", (el) => {
  const b = el.getBoundingClientRect();
  return {
    w: Math.round(b.width),
    h: Math.round(b.height),
    x: Math.round(b.x),
    y: Math.round(b.y),
    centeredX: Math.round(b.x + b.width / 2),
    centeredY: Math.round(b.y + b.height / 2),
  };
});
console.log(JSON.stringify({ viewport: { w: 1080, h: 1920 }, panel: r }, null, 2));
await browser.close();
