# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: room-preview-flow.spec.ts >> Room Preview — landing page >> renders the page title and start button
- Location: tests\e2e\room-preview-flow.spec.ts:6:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('main')
Expected: visible
Error: strict mode violation: locator('main') resolved to 2 elements:
    1) <main class="flex min-h-screen items-center justify-center bg-[#e0d6df]">…</main> aka getByRole('main')
    2) <main class="relative min-h-screen overflow-hidden text-[#1d1d1f]">…</main> aka locator('main').filter({ hasText: 'Start the Trial' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('main')

```

# Page snapshot

```yaml
- main [ref=e2]:
  - paragraph [ref=e5]: Loading Room Preview…
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | // ─── Landing page ─────────────────────────────────────────────────────────────
  4   | 
  5   | test.describe("Room Preview — landing page", () => {
  6   |   test("renders the page title and start button", async ({ page }) => {
  7   |     await page.goto("/room-preview");
  8   | 
  9   |     // The page must load without an error boundary
> 10  |     await expect(page.locator("main")).toBeVisible();
      |                                        ^ Error: expect(locator).toBeVisible() failed
  11  | 
  12  |     // At minimum one heading should exist
  13  |     const heading = page.locator("h1").first();
  14  |     await expect(heading).toBeVisible();
  15  | 
  16  |     // There must be a link/button that navigates to the screen launcher
  17  |     const startLink = page.locator('a[href*="/room-preview/screen"]').first();
  18  |     await expect(startLink).toBeVisible();
  19  |   });
  20  | });
  21  | 
  22  | // ─── Screen launcher → session creation ──────────────────────────────────────
  23  | 
  24  | test.describe("Room Preview — screen launcher", () => {
  25  |   test("creates a session and redirects to the screen/QR page", async ({ page }) => {
  26  |     await page.goto("/room-preview/screen");
  27  | 
  28  |     // The launcher creates a session and then redirects to /room-preview/screen/<id>
  29  |     // Wait for navigation to the session page (up to 15 seconds for API roundtrip)
  30  |     await page.waitForURL(/\/room-preview\/screen\/[^/]+/, { timeout: 15_000 });
  31  | 
  32  |     // We should now be on the screen session page
  33  |     expect(page.url()).toMatch(/\/room-preview\/screen\/.+/);
  34  |   });
  35  | 
  36  |   test("screen session page shows the QR code area", async ({ page }) => {
  37  |     await page.goto("/room-preview/screen");
  38  |     await page.waitForURL(/\/room-preview\/screen\/[^/]+/, { timeout: 15_000 });
  39  | 
  40  |     // The QR code or its container must be on the page
  41  |     // SessionQRCode renders a canvas or svg element
  42  |     const qrContainer = page.locator("canvas, svg, img[alt*='QR'], [data-testid='qr-code']").first();
  43  |     await expect(qrContainer).toBeVisible({ timeout: 5_000 });
  44  |   });
  45  | });
  46  | 
  47  | // ─── Health endpoint ──────────────────────────────────────────────────────────
  48  | 
  49  | test.describe("Health endpoint", () => {
  50  |   test("GET /api/health returns a JSON body with status field", async ({ request }) => {
  51  |     const response = await request.get("/api/health");
  52  | 
  53  |     // Should be 200 (ok) or 503 (degraded) — never 500
  54  |     expect([200, 503]).toContain(response.status());
  55  | 
  56  |     const body = await response.json();
  57  |     expect(["ok", "degraded"]).toContain(body.status);
  58  |     expect(body.checks).toBeDefined();
  59  |     expect(typeof body.ts).toBe("string");
  60  |   });
  61  | });
  62  | 
  63  | // ─── Sessions API contract ────────────────────────────────────────────────────
  64  | 
  65  | test.describe("Sessions API contract", () => {
  66  |   let sessionId: string;
  67  |   let token: string;
  68  | 
  69  |   test("POST /api/room-preview/sessions creates a session", async ({ request }) => {
  70  |     const response = await request.post("/api/room-preview/sessions");
  71  | 
  72  |     expect(response.status()).toBe(201);
  73  |     const body = await response.json();
  74  | 
  75  |     expect(typeof body.id).toBe("string");
  76  |     expect(body.id.length).toBeGreaterThan(0);
  77  |     expect(typeof body.token).toBe("string");
  78  |     expect(body.status).toBe("waiting_for_mobile");
  79  | 
  80  |     sessionId = body.id;
  81  |     token = body.token;
  82  |   });
  83  | 
  84  |   test("GET /api/room-preview/sessions/:id returns the created session", async ({
  85  |     request,
  86  |   }) => {
  87  |     // Create a fresh session for this test
  88  |     const createResp = await request.post("/api/room-preview/sessions");
  89  |     const created = await createResp.json();
  90  | 
  91  |     const response = await request.get(
  92  |       `/api/room-preview/sessions/${created.id}`,
  93  |     );
  94  |     expect(response.status()).toBe(200);
  95  | 
  96  |     const body = await response.json();
  97  |     expect(body.id).toBe(created.id);
  98  |     expect(body.status).toBe("waiting_for_mobile");
  99  |     expect(body.mobileConnected).toBe(false);
  100 |   });
  101 | 
  102 |   test("GET /api/room-preview/sessions/:id returns 404 for unknown id", async ({
  103 |     request,
  104 |   }) => {
  105 |     const response = await request.get(
  106 |       "/api/room-preview/sessions/nonexistent-session-id-xyz",
  107 |     );
  108 |     expect(response.status()).toBe(404);
  109 | 
  110 |     const body = await response.json();
```