import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto("http://localhost:3000/room-preview", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(1500);

const data = await page.$$eval("button.c3d-pill", (els) =>
  els.map((e) => {
    const label = e.querySelector("span");
    const poly = e.querySelector("svg polyline");
    const lr = label?.getBoundingClientRect();
    const sr = e.querySelector("svg")?.getBoundingClientRect();
    const pts = poly?.getAttribute("points") || null;
    // vertex x of a 3-point chevron tells direction: max-x => points right (►), min-x => left (◄)
    let dir = null;
    if (pts) {
      const xs = pts.trim().split(/\s+/).map(Number).filter((_, i) => i % 2 === 0);
      const vertexX = xs[1];
      dir = vertexX >= Math.max(xs[0], xs[2]) ? "right ►" : "left ◄";
    }
    return {
      text: label?.textContent,
      labelCenterX: lr ? Math.round(lr.x + lr.width / 2) : null,
      arrowCenterX: sr ? Math.round(sr.x + sr.width / 2) : null,
      arrowSideOfLabel:
        lr && sr ? (sr.x + sr.width / 2 < lr.x + lr.width / 2 ? "LEFT" : "RIGHT") : "n/a",
      arrowDirection: dir,
    };
  }),
);
console.log(JSON.stringify(data, null, 2));
await browser.close();
