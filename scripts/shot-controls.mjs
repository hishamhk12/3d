import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 3,
});
await page.goto("http://localhost:3000/room-preview", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(2000);

// Locate the three pill buttons and report their on-screen x order + bounds.
const pills = await page.$$eval("button.c3d-pill", (els) =>
  els.map((e) => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent, x: Math.round(r.x), w: Math.round(r.width) };
  }),
);
console.log(JSON.stringify(pills, null, 2));

// Full-width tight strip of the control row, high-res.
await page.screenshot({
  path: "tmp-room-preview/v4-controls-wide.png",
  clip: { x: 120, y: 1355, width: 840, height: 110 },
});
await browser.close();
