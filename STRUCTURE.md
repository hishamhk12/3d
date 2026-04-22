# Project Structure

## Overview

```
بيت الإباء — Room Preview
├── Frontend   → UI, pages, components, hooks
├── Backend    → API routes, services, DB, AI
├── Shared     → Types, constants, i18n, utils
└── Notes      → docs/, CLAUDE.md, AGENTS.md
```

---

## Frontend

### Pages & Routing — `app/`
```
app/
├── layout.tsx                          # Root layout (fonts, i18n provider)
├── page.tsx                            # Home → redirects to /room-preview
├── globals.css                         # Global styles
├── error.tsx / loading.tsx             # Global error/loading boundaries
│
├── room-preview/
│   ├── page.tsx                        # Landing — "ابدأ التجربة" button
│   ├── start/page.tsx                  # Mobile launcher (same-device flow)
│   ├── screen/
│   │   ├── page.tsx                    # Screen launcher → creates session
│   │   └── [sessionId]/page.tsx        # Screen display + QR code
│   ├── mobile/[sessionId]/page.tsx     # Mobile experience (upload + pick)
│   ├── gate/[sessionId]/page.tsx       # Identity gate before mobile
│   └── activate/[sessionId]/page.tsx   # QR scan activation handler
│
└── (admin)/
    ├── layout.tsx
    └── admin/
        ├── page.tsx                    # Dashboard
        ├── analytics/page.tsx          # Analytics
        └── login/page.tsx              # Admin login
```

### Components — `components/`
```
components/
├── ui/
│   ├── AnimatedButton.tsx
│   └── AnimatedLink.tsx
│
├── room-preview/
│   ├── MobileLauncherClient.tsx        # Same-device session creator
│   ├── MobileSessionClient.tsx         # Mobile steps orchestrator
│   ├── ScreenLauncherClient.tsx        # Screen session creator → QR
│   ├── ScreenSessionClient.tsx         # Screen live result display
│   ├── SessionQRCode.tsx               # QR code image component
│   └── SessionStatePanel.tsx           # Error/expired/not-found UI
│
├── AnimatedSuccessButton.tsx
├── CompanyLogo.tsx
├── GlassBackground.tsx
├── LanguageSwitcher.tsx
└── SplashScreen.tsx
```

### Feature UI — `features/`
```
features/room-preview/
├── mobile/
│   ├── RoomStep.tsx                    # Step 1: upload room photo
│   ├── ProductStep.tsx                 # Step 2: pick parquet product
│   ├── ResultStep.tsx                  # Step 3: show rendered result
│   ├── useMobileSession.ts             # Master hook for mobile flow
│   └── debug.tsx                       # Dev debug overlay
│
├── screen/
│   ├── StatusPanel.tsx                 # Live status while waiting
│   └── useScreenSession.ts             # Screen polling/SSE hook
│
└── shared/
    └── helpers.ts                      # Shared UI helpers
```

### Hooks — `hooks/`
```
hooks/
└── useAnimatedNavigation.ts
```

### Static Assets — `public/`
```
public/
├── products/                           # Product images shown in picker
├── PQC201-1220X180X6/                  # Parquet sample images
├── test-assets/                        # Dev test images
├── uploads/room-preview/               # User uploads + rendered outputs
└── شعار/                               # Company logo (SVG)
```

---

## Backend

### API Routes — `app/api/`
```
app/api/
├── health/route.ts                     # GET /api/health
│
├── admin/
│   └── screens/
│       ├── route.ts                    # GET/POST screens
│       └── [screenId]/route.ts         # GET/PATCH/DELETE screen
│
└── room-preview/
    ├── cleanup/route.ts                # POST — expire old sessions
    └── sessions/
        ├── route.ts                    # POST — create session
        └── [sessionId]/
            ├── route.ts                # GET session state
            ├── activate/route.ts       # GET — QR scan → set cookie → redirect
            ├── connect/route.ts        # POST — mobile connects
            ├── events/route.ts         # GET — SSE stream
            ├── room/route.ts           # POST — upload room photo
            ├── product/route.ts        # POST — select product
            ├── render/route.ts         # POST — trigger AI render (202)
            ├── screen-token/route.ts   # POST — store screen token in cookie
            └── test-render/route.ts    # POST — dev render test
```

### Server Actions — `app/**/actions.ts`
```
app/(admin)/admin/actions.ts            # Admin dashboard actions
app/(admin)/admin/login/actions.ts      # Login / logout
app/room-preview/gate/[sessionId]/actions.ts  # Gate form submit
```

### Services & Logic — `lib/`
```
lib/
├── redis.ts                            # Redis client (rate limits, semaphores)
├── storage.ts                          # File storage abstraction
├── ip-rate-limit.ts                    # IP-based rate limiting
├── env.ts                              # Env var validation (Zod)
├── logger.ts                           # Structured logger (pino)
│
├── server/
│   └── prisma.ts                       # Prisma singleton (server-only)
│
├── admin/
│   ├── auth.ts                         # JWT auth for admin
│   ├── queries.ts                      # General admin DB queries
│   ├── analytics-queries.ts            # Analytics aggregations
│   ├── user-analytics-queries.ts       # Per-user analytics
│   └── session-dashboard.ts           # Dashboard data service
│
├── analytics/
│   ├── event-tracker.ts                # Fire & forget event logging
│   ├── user-session-service.ts         # Gate completion tracking
│   └── validators.ts                   # Event payload validation
│
└── room-preview/
    │
    ├── ── Session ──
    ├── session-service.ts              # Business logic (create, connect, expire)
    ├── session-repository.ts           # DB read/write (Prisma)
    ├── session-machine.ts              # State machine (transitions)
    ├── session-store.ts                # In-memory session cache
    ├── session-events.ts               # SSE event bus
    ├── session-events-client.ts        # SSE publisher
    ├── session-cleanup.ts              # Expiry & cleanup
    ├── session-token.ts                # HMAC token sign/verify
    │
    ├── ── Render ──
    ├── render-service.ts               # Pipeline orchestrator
    ├── render-repository.ts            # Render job DB access
    ├── render-input.ts                 # Input validation
    ├── render-rate-limit.ts            # Device cooldown & budgets
    ├── gemini-semaphore.ts             # Concurrency slots (Redis)
    │
    ├── render-providers/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── ai-provider.ts              # Provider interface
    │   └── gemini-provider.ts          # Google Gemini implementation
    │
    ├── ── AI Prompts ──
    ├── prompts.ts                      # Prompt dispatcher
    ├── prompt-template-v2.ts           # Floor replacement prompt
    ├── product-prompts.ts              # Product-type helpers
    │
    ├── ── Room & Product ──
    ├── room-service.ts                 # Upload + save room photo
    ├── product-service.ts              # Save product selection
    ├── upload-service.ts               # File upload to storage
    ├── image-compress.ts               # Client-side image compression
    ├── local-assets.ts                 # Serve local product images
    │
    ├── ── Screen ──
    ├── screen-repository.ts            # Screen DB access
    └── screen-token.ts                 # Screen auth token
```

### Database — `prisma/`
```
prisma/
├── schema.prisma                       # DB schema (Session, RenderJob, Screen, UserSession)
└── migrations/
    ├── 20260401_init_room_preview_sessions/
    ├── 20260401_add_render_jobs/
    ├── 20260413_add_session_expiry/
    ├── 20260414_add_render_count/
    ├── 20260415_add_user_session_and_events/
    └── 20260419_add_screen_model/
```

### Monitoring — root
```
instrumentation.ts                      # Server startup hooks (Sentry init)
sentry.client.config.ts
sentry.server.config.ts
sentry.edge.config.ts
proxy.ts                                # Dev proxy config
```

---

## Shared

### Types & Constants — `lib/room-preview/`
```
lib/room-preview/
├── types.ts                            # All shared TS types
├── constants.ts                        # Routes, timeouts, limits
├── cookies.ts                          # Cookie name constants
├── validators.ts                       # Zod schemas
├── session-status.ts                   # Status helper functions
├── api-guard.ts                        # Request auth middleware
│
├── session-client.ts                   # Browser → API fetch calls
└── session-polling.ts                  # Browser polling logic
```

### Internationalization — `lib/i18n/`
```
lib/i18n/
├── config.ts                           # Locale config (ar / en)
├── dictionaries.ts                     # All UI strings (Arabic + English)
├── types.ts                            # Dictionary type definitions
└── provider.tsx                        # React context provider
```

### Data — `data/`
```
data/
├── products.ts                         # Product catalog
└── room-preview/
    ├── mock-products.ts                # Products shown in mobile picker
    └── demo-rooms.ts                   # Demo room images
```

---

## Tests — `tests/`
```
tests/
├── setup.ts                            # Vitest global setup
├── globals.d.ts
├── __mocks__/server-only.ts
│
├── unit/
│   ├── session-machine.test.ts
│   ├── session-token.test.ts
│   ├── session-status.test.ts
│   ├── session-dashboard.test.ts
│   ├── session-repository-cleanup.test.ts
│   ├── validators.test.ts
│   └── sse-cleanup.test.ts
│
├── integration/
│   ├── sessions-api.test.ts
│   ├── session-connect-api.test.ts
│   ├── session-render-api.test.ts
│   ├── health-api.test.ts
│   └── cleanup-api.test.ts
│
└── e2e/
    └── room-preview-flow.spec.ts
```

---

## Notes — `docs/`
```
docs/
├── documentation.md                    # Feature documentation
└── system-design.md                    # Architecture & system design
```

---

## Config — root
```
.env                                    # API keys, DB URL, secrets
.env.local                              # Local overrides (port, models)
.env.example                            # Template for new devs
next.config.ts                          # Next.js config
tsconfig.json                           # TypeScript config
eslint.config.mjs                       # Linting rules
vitest.config.ts                        # Unit/integration test config
playwright.config.ts                    # E2E test config
prisma.config.ts                        # Prisma config
vercel.json                             # Deployment config
```
