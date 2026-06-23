# npm Security Remediation — 3d (Room Preview)

> معالجة آمنة لنتائج `npm audit` بدون `--force` وبدون downgrade وبدون تغيير Major.
> التاريخ: 2026-06-23 · Node.js: v24.13.0 · بيئة: `3d/`.

## 1. النتيجة قبل الإصلاح

`npm audit --omit=dev` (production):

| Severity | Count |
| --- | --- |
| Critical | 1 |
| High | 6 |
| Moderate | 13 |
| Low | 1 |
| **Total** | **21** |

## 2. النتيجة بعد الإصلاح

| Severity | Full (`npm audit`) | Production (`--omit=dev`) |
| --- | --- | --- |
| Critical | 0 | 0 |
| High | 0 | 0 |
| Moderate | 5 | 5 |
| Low | 0 | 0 |
| **Total** | **5** | **5** |

أُغلقت **16** ثغرة (بما فيها الـ critical الوحيد وكل الـ high والـ low)، والمتبقي 5 moderate من جذرين upstream فقط.

## 3. Dependency chains لكل ثغرة (تحليل قبل الإصلاح)

| Vulnerable package | Severity | Direct parent (root) | Runtime / Tooling | Safe fix | Action |
| --- | --- | --- | --- | --- | --- |
| protobufjs (≤7.6.2) | critical | `@google/genai` | Runtime | `npm audit fix` (bump within range) | ✅ مُصلَح |
| @protobufjs/utf8 | moderate | `protobufjs` ← `@google/genai` | Runtime | `npm audit fix` | ✅ مُصلَح |
| next (+ نسخة postcss العليا) | high/mod | root `next` | Runtime | `npm install next@16.2.9` | ✅ مُصلَح |
| postcss (top-level) | moderate | `tailwindcss` build chain | Build | `npm audit fix` | ✅ مُصلَح |
| defu | high | `prisma` → `@prisma/config` → `c12` | Tooling (Prisma CLI) | `npm audit fix` | ✅ مُصلَح |
| fast-uri | high | `@modelcontextprotocol/sdk` (genai+shadcn) / webpack(sentry) | Mixed | `npm audit fix` | ✅ مُصلَح |
| fast-xml-builder | high | `@aws-sdk/client-s3` → `fast-xml-parser` | Runtime | `npm audit fix` | ✅ مُصلَح |
| hono (≤4.12.24) | high | `@google/genai` → MCP SDK / `shadcn` | Runtime+Tooling | `npm audit fix` | ✅ مُصلَح |
| ws | high | `@next/bundle-analyzer` (v7) / `@google/genai` (v8) | Tooling+Runtime | `npm audit fix` | ✅ مُصلَح |
| @opentelemetry/core (+resources, sdk-trace-base, instrumentation-http) | moderate | `@sentry/nextjs` → `@sentry/node` | Runtime | `npm audit fix` (dedupe ≥2.8.0) | ✅ مُصلَح |
| @babel/core | moderate | build tooling | Tooling | `npm audit fix` | ✅ مُصلَح |
| js-yaml | moderate | build/CLI tooling | Tooling | `npm audit fix` | ✅ مُصلَح |
| brace-expansion | moderate | `@fastify/otel` (sentry) / `glob` | Mixed | `npm audit fix` | ✅ مُصلَح |
| @hono/node-server (<1.19.13) | moderate | `prisma` → `@prisma/dev` | **Tooling (Prisma local `dev` server)** | downgrade prisma@6 فقط (مرفوض) | ⏳ مؤجّل |
| postcss (داخل next) | moderate | `next` (`node_modules/next/node_modules/postcss`) | Build (داخل next) | downgrade next@9 فقط (مرفوض) | ⏳ مؤجّل |

## 4. التحديثات التي نُفِّذت

- **Next.js**: `16.2.1` → `^16.2.9` (تحديث مستهدف، Phase 2). أغلق سلسلة Next.js DoS/SSRF/cache-poisoning + postcss العليا.
- **`npm audit fix`** (بدون `--force`, Phase 3): أصلح على مستوى الـ lockfile الحزم المتعدية التالية بدون تغيير أي dependency مباشر:
  - protobufjs + @protobufjs/utf8، defu، fast-uri، fast-xml-builder، hono، ws، @opentelemetry/* (عبر dedupe)، @babel/core، js-yaml، brace-expansion، postcss العليا.
- **التغيير الوحيد في `package.json`**: حقل `next` فقط (انظر §7). باقي التغييرات في `package-lock.json` فقط.
- ملاحظة: `next` كان مثبتاً exact (`16.2.1`) وأصبح caret (`^16.2.9`) — أثر جانبي طبيعي لـ `npm install` ويسمح بتحديثات patch ضمن 16.x.

## 5. الثغرات المتبقية (5 moderate) — التصنيف

كلها تعود إلى **جذرين upstream**، و«الإصلاح» الوحيد الذي يعرضه npm لكليهما هو downgrade ممنوع:

### أ) `@hono/node-server` <1.19.13 — (3 مدخلات: `@hono/node-server`, `@prisma/dev`, `prisma`)
- المصدر: `prisma` (CLI) → `@prisma/dev@0.24.3` → `@hono/node-server@1.19.11`.
- **Tooling فقط، وليست Runtime**: `@prisma/dev` يخدم أمر `prisma dev` (خادم قاعدة بيانات تطوير محلي). لا يدخل في bundle التطبيق، ولا في `prisma generate`، ولا في `prisma migrate deploy` بالإنتاج. المسار المعطوب (`serveStatic` repeated-slash bypass) لا يُستدعى من تشغيل تطبيق Next.js.
- لماذا لم نحدّث Prisma: حتى أحدث **prisma 7 stable (7.8.0)** ما زال يثبّت `@prisma/dev@0.24.3` نفسه (تحقّق: `npm view prisma@7.8.0 dependencies.@prisma/dev` = `0.24.3`)، فترقية 7.6→7.8 **لا تُغلق** هذه الثغرة وتضيف churn بلا فائدة أمنية.
- لماذا لا downgrade: `npm audit fix --force` يقترح `prisma@6.19.3` (downgrade major — مرفوض صراحةً).

### ب) `postcss` <8.5.10 داخل `next` — (مدخلان: `next`, `postcss`)
- المصدر: `next@16.2.9` يحزم نسخته الخاصة في `node_modules/next/node_modules/postcss`.
- **Build-time** (داخل خط CSS الخاص بـ next)، والثغرة XSS via Unescaped `</style>` في مخرجات Stringify.
- نسخة postcss العليا (المستخدمة عبر Tailwind) **أُصلحت** بالفعل بـ `npm audit fix`؛ المتبقي هو النسخة المدمجة داخل next والتي يتحكم بها next.
- لماذا لا downgrade: `npm audit fix --force` يقترح `next@9.3.3` (downgrade major عبثي — مرفوض). و`16.2.9` هو أحدث patch ضمن 16.2.x.

## 6. هل المتبقي Runtime أم Tooling؟

| الثغرة المتبقية | التصنيف | تُستدعى في تشغيل الإنتاج؟ |
| --- | --- | --- |
| @hono/node-server (prisma) | Tooling — Prisma local dev CLI | لا |
| postcss (داخل next) | Build-time داخل next | لا (وقت البناء فقط) |

لا توجد ثغرة متبقية في مسار **runtime** للتطبيق المنشور.

## 7. التحقق (Validation)

| الفحص | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | ✅ نجاح (0 أخطاء) |
| `npm run build` | ✅ نجاح |
| `npx vitest run` | ⚠️ 580 ناجح / 3 فاشل — **فشل سابق غير متعلق** |
| `npm audit` / `--omit=dev` | 5 moderate (0 critical/high/low) |

### بخصوص الـ 3 اختبارات الفاشلة (`tests/unit/session-dashboard.test.ts`)
- السبب: `prisma.roomPreviewSession.groupBy is not a function` — الـ mock في الاختبار (سطر 14) يعرّف `{ count, findMany }` فقط بلا `groupBy`، بينما `lib/admin/session-dashboard.ts:49` يستدعي `groupBy`.
- **مُثبَت أنه سابق وغير متعلق بهذا العمل**: عند إرجاع `next@16.2.1` (baseline عبر `git stash` + `npm ci`) تفشل نفس الـ3 اختبارات بالضبط. مصدره commit `594b376` (غُيّر المصدر ولم يُحدَّث الـ mock). لم يُدخل هذا العمل أي فشل جديد.

`package.json` diff:
```diff
-    "next": "16.2.1",
+    "next": "^16.2.9",
```
`package-lock.json`: تحديثات نسخ متعدية فقط (لا توجد تغييرات direct dependencies أخرى).

## 8. مخاطر / تحديثات تحتاج موافقة (خطة المتابعة)

1. **@hono/node-server (Prisma dev CLI)** — لا إجراء آمن الآن. خيارات للمتابعة:
   - انتظار إصدار `prisma` يرفع `@prisma/dev` إلى نسخة تستخدم `@hono/node-server ≥1.19.13` (مفضّل).
   - بديل يحتاج موافقة: نقل `prisma` CLI من `dependencies` إلى `devDependencies` (انظر النقطة 3) — يُخرج السلسلة من `--omit=dev` لكنه لا «يصلح» الثغرة فعلياً، فقط يعكس واقع أنها أداة بناء/تطوير.
   - بديل يحتاج موافقة: `overrides` لرفع `@prisma/dev`/`@hono/node-server` — مرفوض حالياً (لم يُثبت توافقه مع Prisma CLI، ومخاطرته أعلى من فائدة moderate في أداة dev-only).
2. **postcss داخل next** — يُغلق تلقائياً عند إصدار next يرفع postcss المدمجة إلى ≥8.5.10. بديل يحتاج موافقة: `overrides: { "postcss": ">=8.5.10" }` لإجبار نسخة next الداخلية — يحتاج إثبات توافق مع خط بناء CSS في next قبل التطبيق.
3. **موضع `prisma` CLI**: حالياً في `dependencies` (السطر الذي يجعل سلسلة Prisma تظهر في `--omit=dev`). تقنياً: الإنتاج يحتاج `@prisma/client` + `@prisma/adapter-pg` للتشغيل، و`prisma` CLI لـ `prisma generate` (داخل `build`) و`prisma migrate deploy`. نقله إلى `devDependencies` **آمن فقط** إذا كانت بيئة النشر تثبّت devDependencies وقت البناء/الترحيل (مثل Vercel، أو Docker بمرحلة build تشمل devDeps). إن كان النشر يستخدم `npm ci --omit=dev` ثم يشغّل migrations، فالنقل سيكسر الترحيل. **قرار يحتاج تأكيد بيئة النشر — لم يُنفّذ.**
4. **Prisma 7.8.0** متاح (minor، غير كاسر) لكنه لا يحل أي ثغرة حالية؛ يُترك لقرار صيانة مستقل (لا يندرج ضمن هذه المعالجة الأمنية).

## 9. ما لم يُفعل (التزاماً بالقواعد)
- ❌ لا `npm audit fix --force`.
- ❌ لا downgrade لـ Prisma 7 → 6.
- ❌ لا تغيير Major لأي dependency.
- ❌ لا `overrides`.
- ❌ لا تعديل كود تطبيق.
- ❌ لا Push ولا Deploy.
