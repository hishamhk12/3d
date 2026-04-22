# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: room-preview-flow.spec.ts >> Sessions API contract >> POST connect succeeds with a valid token
- Location: tests\e2e\room-preview-flow.spec.ts:127:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 404
```

# Test source

```ts
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
  111 |     expect(body.code).toBe("SESSION_NOT_FOUND");
  112 |   });
  113 | 
  114 |   test("POST connect returns 401 without token", async ({ request }) => {
  115 |     const createResp = await request.post("/api/room-preview/sessions");
  116 |     const { id } = await createResp.json();
  117 | 
  118 |     const response = await request.post(
  119 |       `/api/room-preview/sessions/${id}/connect`,
  120 |     );
  121 |     expect(response.status()).toBe(401);
  122 | 
  123 |     const body = await response.json();
  124 |     expect(body.code).toBe("UNAUTHORIZED");
  125 |   });
  126 | 
  127 |   test("POST connect succeeds with a valid token", async ({ request }) => {
  128 |     const createResp = await request.post("/api/room-preview/sessions");
  129 |     const { id, token: sessionToken } = await createResp.json();
  130 | 
  131 |     const response = await request.post(
  132 |       `/api/room-preview/sessions/${id}/connect`,
  133 |       { headers: { "x-session-token": sessionToken } },
  134 |     );
> 135 |     expect(response.status()).toBe(200);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  136 | 
  137 |     const body = await response.json();
  138 |     expect(body.success).toBe(true);
  139 | 
  140 |     // Verify the session reflects the connected state
  141 |     const sessionResp = await request.get(`/api/room-preview/sessions/${id}`);
  142 |     const session = await sessionResp.json();
  143 |     expect(session.status).toBe("mobile_connected");
  144 |     expect(session.mobileConnected).toBe(true);
  145 |   });
  146 | });
  147 | 
  148 | // ─── Mobile page ─────────────────────────────────────────────────────────────
  149 | 
  150 | test.describe("Mobile session page", () => {
  151 |   test("renders without error when navigated to directly", async ({ page, request }) => {
  152 |     // Create a session first
  153 |     const createResp = await request.post("/api/room-preview/sessions");
  154 |     const { id, token: sessionToken } = await createResp.json();
  155 | 
  156 |     await page.goto(`/room-preview/mobile/${id}?t=${encodeURIComponent(sessionToken)}`);
  157 | 
  158 |     // The page should render without showing a generic error
  159 |     await expect(page.locator("main")).toBeVisible();
  160 | 
  161 |     // Should NOT show the root error boundary
  162 |     const errorHeading = page.getByRole("heading", { name: /unexpected error/i });
  163 |     await expect(errorHeading).not.toBeVisible();
  164 |   });
  165 | });
  166 | 
  167 | // ─── Two-context flow: screen + mobile ───────────────────────────────────────
  168 | 
  169 | test.describe("Full screen + mobile pairing flow", () => {
  170 |   test("session status updates to mobile_connected after mobile connects", async ({
  171 |     browser,
  172 |     request,
  173 |   }) => {
  174 |     // 1. Create a session (simulating what the screen launcher does)
  175 |     const createResp = await request.post("/api/room-preview/sessions");
  176 |     expect(createResp.status()).toBe(201);
  177 |     const { id: sessionId, token: sessionToken } = await createResp.json();
  178 | 
  179 |     // 2. Open the screen page in one browser context
  180 |     const screenCtx = await browser.newContext();
  181 |     const screenPage = await screenCtx.newPage();
  182 |     await screenPage.goto(
  183 |       `/room-preview/screen/${sessionId}?token=${encodeURIComponent(sessionToken)}`,
  184 |     );
  185 |     await expect(screenPage.locator("main")).toBeVisible();
  186 | 
  187 |     // 3. Open the mobile page in a separate browser context (different "device")
  188 |     const mobileCtx = await browser.newContext();
  189 |     const mobilePage = await mobileCtx.newPage();
  190 |     await mobilePage.goto(
  191 |       `/room-preview/mobile/${sessionId}?t=${encodeURIComponent(sessionToken)}`,
  192 |     );
  193 |     await expect(mobilePage.locator("main")).toBeVisible();
  194 | 
  195 |     // 4. After the mobile page loads it calls POST /connect — poll until done
  196 |     await expect
  197 |       .poll(
  198 |         async () => {
  199 |           const resp = await request.get(`/api/room-preview/sessions/${sessionId}`);
  200 |           const session = await resp.json();
  201 |           return session.status;
  202 |         },
  203 |         { timeout: 10_000, intervals: [500] },
  204 |       )
  205 |       .toBe("mobile_connected");
  206 | 
  207 |     await screenCtx.close();
  208 |     await mobileCtx.close();
  209 |   });
  210 | });
  211 | 
```