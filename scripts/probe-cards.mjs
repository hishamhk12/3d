import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
});
await page.goto("http://localhost:3000/room-preview", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const out = {};
  out.viewport = { w: window.innerWidth, h: window.innerHeight };
  // board
  const board = document.querySelector('[role="region"][aria-roledescription="carousel"]')?.parentElement;
  // active card
  const active = document.querySelector('[aria-current="true"]');
  if (active) {
    const r = active.getBoundingClientRect();
    out.activeCard = { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    out.activePctOfViewport = Math.round((r.width / window.innerWidth) * 1000) / 10;
  }
  // all coverflow cards (motion.div with willChange transform inside the track)
  const track = document.querySelector('[aria-roledescription="carousel"]');
  if (track) {
    const cards = [...track.children].filter((c) => c.getAttribute("aria-label"));
    out.cards = cards.map((c) => {
      const r = c.getBoundingClientRect();
      return {
        label: c.getAttribute("aria-label"),
        w: Math.round(r.width),
        h: Math.round(r.height),
        left: Math.round(r.x),
        right: Math.round(r.x + r.width),
      };
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
