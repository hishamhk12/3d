import { chromium } from "@playwright/test";

const url = "http://localhost:3000/room-preview";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });

const consoleIssues = [];
page.on("console", (m) => {
  const t = m.text();
  if (/hydrat|Warning|error/i.test(t)) consoleIssues.push(`[${m.type()}] ${t}`);
});
page.on("pageerror", (e) => consoleIssues.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

// Active index is derived from the active card (aria-current="true"),
// whose aria-label is "الصورة N نشطة" → index = N - 1.
const activeIdx = async () =>
  page.$eval('[aria-current="true"]', (el) => {
    const m = (el.getAttribute("aria-label") || "").match(/(\d+)/);
    return m ? Number(m[1]) - 1 : -1;
  });

const start = await activeIdx();

// next
await page.getByRole("button", { name: "التالي" }).click();
await page.waitForTimeout(700);
const afterNext = await activeIdx();

// prev (twice -> should land at start-1 wrapped)
await page.getByRole("button", { name: "السابق" }).click();
await page.waitForTimeout(700);
const afterPrev = await activeIdx();

// play/pause toggle present + labelled
const pauseBtn = page.getByRole("button", { name: "إيقاف العرض التلقائي" });
const hasPause = await pauseBtn.count();
await pauseBtn.first().click();
await page.waitForTimeout(300);
const hasPlay = await page
  .getByRole("button", { name: "تشغيل العرض التلقائي" })
  .count();

// CTA href
const cta = page.getByRole("link", { name: "ابدأ التجربة" });
const href = await cta.getAttribute("href");

console.log(
  JSON.stringify(
    {
      start,
      afterNext,
      afterPrev,
      nextWorks: afterNext === (start + 1) % 11,
      prevWorks: afterPrev === start,
      playPauseToggles: hasPause === 1 && hasPlay === 1,
      ctaHref: href,
      consoleIssues,
    },
    null,
    2,
  ),
);
await browser.close();
