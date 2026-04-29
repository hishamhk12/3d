import { expect, test } from "@playwright/test";

// ─── Landing page ─────────────────────────────────────────────────────────────

test.describe("Room Preview — landing page", () => {
  test("renders the page title and start button", async ({ page }) => {
    await page.goto("/room-preview");

    // The page must load without an error boundary
    await expect(page.locator("main")).toBeVisible();

    // At minimum one heading should exist
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();

    // There must be a link/button that navigates to the screen launcher
    const startLink = page.locator('a[href*="/room-preview/screen"]').first();
    await expect(startLink).toBeVisible();
  });
});

// ─── Screen launcher → session creation ──────────────────────────────────────

test.describe("Room Preview — screen launcher", () => {
  test("creates a session and redirects to the screen/QR page", async ({ page }) => {
    await page.goto("/room-preview/screen");

    // The launcher creates a session and then redirects to /room-preview/screen/<id>
    // Wait for navigation to the session page (up to 15 seconds for API roundtrip)
    await page.waitForURL(/\/room-preview\/screen\/[^/]+/, { timeout: 15_000 });

    // We should now be on the screen session page
    expect(page.url()).toMatch(/\/room-preview\/screen\/.+/);
  });

  test("screen session page shows the QR code area", async ({ page }) => {
    await page.goto("/room-preview/screen");
    await page.waitForURL(/\/room-preview\/screen\/[^/]+/, { timeout: 15_000 });

    // The QR code or its container must be on the page
    // SessionQRCode renders a canvas or svg element
    const qrContainer = page.locator("canvas, svg, img[alt*='QR'], [data-testid='qr-code']").first();
    await expect(qrContainer).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Health endpoint ──────────────────────────────────────────────────────────

test.describe("Health endpoint", () => {
  test("GET /api/health returns a JSON body with status field", async ({ request }) => {
    const response = await request.get("/api/health");

    // Should be 200 (ok) or 503 (degraded) — never 500
    expect([200, 503]).toContain(response.status());

    const body = await response.json();
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.checks).toBeDefined();
    expect(typeof body.ts).toBe("string");
  });
});

// ─── Sessions API contract ────────────────────────────────────────────────────

test.describe("Sessions API contract", () => {
  test("POST /api/room-preview/sessions creates a session", async ({ request }) => {
    const response = await request.post("/api/room-preview/sessions");

    expect(response.status()).toBe(201);
    const body = await response.json();

    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
    expect(typeof body.token).toBe("string");
    expect(body.status).toBe("waiting_for_mobile");
  });

  test("GET /api/room-preview/sessions/:id returns the created session", async ({
    request,
  }) => {
    // Create a fresh session for this test
    const createResp = await request.post("/api/room-preview/sessions");
    const created = await createResp.json();

    const response = await request.get(
      `/api/room-preview/sessions/${created.id}`,
    );
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(created.id);
    expect(body.status).toBe("waiting_for_mobile");
    expect(body.mobileConnected).toBe(false);
  });

  test("GET /api/room-preview/sessions/:id returns 404 for unknown id", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/room-preview/sessions/nonexistent-session-id-xyz",
    );
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });

  test("POST connect returns 401 without token", async ({ request }) => {
    const createResp = await request.post("/api/room-preview/sessions");
    const { id } = await createResp.json();

    const response = await request.post(
      `/api/room-preview/sessions/${id}/connect`,
    );
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  test("POST connect succeeds with a valid token", async ({ request }) => {
    const createResp = await request.post("/api/room-preview/sessions");
    const { id, token: sessionToken } = await createResp.json();

    const response = await request.post(
      `/api/room-preview/sessions/${id}/connect`,
      { headers: { "x-session-token": sessionToken } },
    );
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("mobile_connected");
    expect(body.mobileConnected).toBe(true);

    // Verify the session reflects the connected state
    const sessionResp = await request.get(`/api/room-preview/sessions/${id}`);
    const session = await sessionResp.json();
    expect(session.status).toBe("mobile_connected");
    expect(session.mobileConnected).toBe(true);
  });
});

// ─── Mobile page ─────────────────────────────────────────────────────────────

test.describe("Mobile session page", () => {
  test("redirects tokenized mobile links through activation", async ({ page, request }) => {
    // Create a session first
    const createResp = await request.post("/api/room-preview/sessions");
    const { id, token: sessionToken } = await createResp.json();

    await page.goto(`/room-preview/mobile/${id}?t=${encodeURIComponent(sessionToken)}`);

    // The page should render without showing a generic error
    await expect(page.locator("main")).toBeVisible();

    // Should NOT show the root error boundary
    const errorHeading = page.getByRole("heading", { name: /unexpected error/i });
    await expect(errorHeading).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/room-preview/(mobile|gate)/${id}`));
  });
});

// ─── Two-context flow: screen + mobile ───────────────────────────────────────

test.describe("Full screen + mobile pairing flow", () => {
  test("session status updates to mobile_connected after QR activation and gate submit", async ({
    browser,
    request,
  }) => {
    // 1. Create a session (simulating what the screen launcher does)
    const createResp = await request.post("/api/room-preview/sessions");
    expect(createResp.status()).toBe(201);
    const { id: sessionId, token: sessionToken } = await createResp.json();

    // 2. Open the screen page in one browser context
    const screenCtx = await browser.newContext();
    const screenPage = await screenCtx.newPage();
    await screenPage.goto(`/room-preview/screen/${sessionId}`);
    await expect(screenPage.locator("main")).toBeVisible();

    // 3. Open the mobile activation URL in a separate browser context (different "device")
    const mobileCtx = await browser.newContext();
    const mobilePage = await mobileCtx.newPage();

    await mobilePage.goto(
      `/api/room-preview/sessions/${sessionId}/activate?t=${encodeURIComponent(sessionToken)}&lang=ar`,
    );
    await expect(mobilePage.locator("main")).toBeVisible();

    // 4. Complete the customer gate. The gate action connects the mobile session
    // before the final navigation, so the client is not dependent on a post-redirect
    // auto-connect request.
    await mobilePage.locator('a[href*="role=customer"]').click();
    await mobilePage.locator('input[name="name"]').fill("Playwright Customer");
    await mobilePage.locator('input[name="phone"]').fill("+966501234567");
    await mobilePage.locator('button[type="submit"]').click();
    await mobilePage.waitForURL(new RegExp(`/room-preview/mobile/${sessionId}`), {
      timeout: 15_000,
    });

    // 5. Verify the DB-backed session reflects the connected state.
    await expect
      .poll(
        async () => {
          const resp = await request.get(`/api/room-preview/sessions/${sessionId}`);
          const session = await resp.json();
          return session.status;
        },
        { timeout: 10_000, intervals: [500] },
      )
      .toBe("mobile_connected");

    await screenCtx.close();
    await mobileCtx.close();
  });
});
