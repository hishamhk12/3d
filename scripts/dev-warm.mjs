// Starts `next dev` (Turbopack, LAN-reachable) and pre-compiles the Room
// Preview routes as soon as the server is up, so the first QR scan from a phone
// doesn't wait on on-demand compilation (white page / request timeouts).
//
// Usage: npm run dev         (extra args are forwarded to `next dev`)
//        npm run dev:https   (--tunnel: also opens a Cloudflare Quick Tunnel so
//                             the phone gets a real https:// URL — browsers only
//                             allow the live camera on secure origins)

import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3000";
const base = `http://localhost:${port}`;

// Dummy session id: the routes render their "not found" state, but Next still
// compiles the full route (server + client chunks), which is all we need.
const WARM_ID = "warmup";
const ROUTES = [
  "/",
  "/room-preview",
  "/room-preview/screen",
  // /room-preview/screen/[id] is skipped: it logs a session event, which fails
  // for a dummy id. It's the laptop's page anyway — the phone never waits on it.
  `/room-preview/gate/${WARM_ID}`,
  `/room-preview/mobile/${WARM_ID}`,
  // Single catch-all API route — compiling it once covers every endpoint.
  `/api/room-preview/sessions/${WARM_ID}`,
];

const useTunnel = process.argv.includes("--tunnel");
const nextArgs = process.argv.slice(2).filter((arg) => arg !== "--tunnel");
const children = [];

/**
 * Start `cloudflared tunnel --url` (no account needed) and resolve with the
 * public https://*.trycloudflare.com URL it prints on stderr.
 */
function startTunnel() {
  return new Promise((resolve, reject) => {
    const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", base], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(tunnel);
    const timer = setTimeout(() => reject(new Error("no tunnel URL after 30s")), 30_000);
    const onData = (chunk) => {
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);
    tunnel.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const env = { ...process.env };
let tunnelUrl = null;
if (useTunnel) {
  try {
    tunnelUrl = await startTunnel();
    // Overrides .env.local (Next never overwrites an existing env var): the QR
    // points at the tunnel, and next.config allowlists its host for dev.
    env.NEXT_PUBLIC_BASE_URL = tunnelUrl;
  } catch (error) {
    console.error(`[dev-warm] Could not start the https tunnel: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const child = spawn("npx", ["next", "dev", "--hostname", "0.0.0.0", ...nextArgs], {
  stdio: "inherit",
  env,
});
children.push(child);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const proc of children) proc.kill(signal);
  });
}
child.on("exit", (code) => {
  for (const proc of children) proc.kill();
  process.exit(code ?? 0);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      await fetch(`${base}/api/health`, { redirect: "manual" });
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

/** Fetch a page, then its referenced /_next/ script chunks so client bundles compile too. */
async function warm(path) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    const html = await res.text();
    const chunks = [...html.matchAll(/<script[^>]+src="(\/_next\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(
      [...new Set(chunks)].map((src) => fetch(`${base}${src}`).then((r) => r.arrayBuffer()).catch(() => {})),
    );
    return `${path} (${Date.now() - started}ms)`;
  } catch (error) {
    return `${path} failed: ${error instanceof Error ? error.message : error}`;
  }
}

if (await waitForServer()) {
  console.log("\n[dev-warm] Pre-compiling Room Preview routes…");
  // Sequential: parallel compiles compete for CPU and finish no sooner.
  for (const route of ROUTES) {
    console.log(`[dev-warm]   ✓ ${await warm(route)}`);
  }
  console.log("[dev-warm] Ready — scan the QR now.");
  if (tunnelUrl) {
    console.log(`[dev-warm] https (camera works): ${tunnelUrl}/room-preview`);
  }
  console.log("");
} else {
  console.warn("[dev-warm] Server did not start in time; skipping warm-up.");
}
