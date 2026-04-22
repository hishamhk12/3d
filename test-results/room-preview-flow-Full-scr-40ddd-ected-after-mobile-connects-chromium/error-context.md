# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: room-preview-flow.spec.ts >> Full screen + mobile pairing flow >> session status updates to mobile_connected after mobile connects
- Location: tests\e2e\room-preview-flow.spec.ts:170:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "mobile_connected"
Received: undefined

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e6] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e7]:
      - img [ref=e8]
    - generic [ref=e11]:
      - button "Open issues overlay" [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: "0"
          - generic [ref=e15]: "1"
        - generic [ref=e16]: Issue
      - button "Collapse issues badge" [ref=e17]:
        - img [ref=e18]
  - alert [ref=e20]
  - main [ref=e21]:
    - generic [ref=e22]:
      - paragraph [ref=e23]: Room Preview
      - heading "Something went wrong" [level=1] [ref=e24]
      - paragraph [ref=e25]: useI18n must be used within an I18nProvider.
      - generic [ref=e26]:
        - button "Try again" [ref=e27]
        - link "Back to Room Preview" [ref=e28] [cursor=pointer]:
          - /url: /room-preview
```

# Test source

```ts
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
  135 |     expect(response.status()).toBe(200);
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
> 196 |     await expect
      |     ^ Error: expect(received).toBe(expected) // Object.is equality
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