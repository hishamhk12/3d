# Deployment Handoff

## 1. فكرة التطبيق
- تطبيق معاينة غرف بالذكاء الاصطناعي للمعارض والمتاجر.
- شاشة كبيرة (TV / Kiosk) تنشئ جلسة وتعرض QR Code.
- العميل يفتح الرابط من موبايله عبر مسح الـ QR.
- العميل يرفع صورة الغرفة ويختار منتجاً (مثل باركيه).
- Google Gemini يولّد صورة واقعية للغرفة مع المنتج.
- النتيجة تظهر فوراً على الموبايل والشاشة معاً عبر SSE.

---

## 2. التقنيات المستخدمة
- **الإطار:** Next.js 16 (App Router) على Node.js
- **الواجهة:** React 19، TypeScript، Tailwind CSS 4
- **قاعدة البيانات:** PostgreSQL مع Prisma ORM (adapter-pg)
- **الوقت الفعلي:** SSE (Server-Sent Events) عبر Redis Pub/Sub
- **Redis:** ioredis — للتزامن والـ rate limiting والـ render locks
- **التخزين:** Cloudflare R2 أو AWS S3 (local للتطوير فقط)
- **الذكاء الاصطناعي:** Google Gemini API (server-side فقط)
- **معالجة الصور:** Sharp
- **تتبع الأخطاء:** Sentry (اختياري)
- **السجلات:** Pino

---

## 3. ما سأقوم بتسليمه
- الكود الكامل للمشروع.
- ملف `.env.example` بأسماء المتغيرات ة.

---

## 4. ما يجب على فريق الديبلويمنت عمله
- اختيار منصة التشغيل (Vercel، VPS، Docker، AWS، Render، DigitalOcean — أي منصة تدعم Node.js).
- إنشاء قاعدة بيانات PostgreSQL خارجية (مثل Neon أو Supabase أو RDS).
- إنشاء Redis خارجي (مثل Upstash أو Redis Cloud).
- إنشاء Storage Bucket على Cloudflare R2 أو AWS S3 وضبط CORS.
- إنشاء الـ Secrets المطلوبة (`SESSION_TOKEN_SECRET`، `ADMIN_JWT_SECRET`، `CLEANUP_SECRET`).
- ضبط جميع متغيرات البيئة على السيرفر.
- ضبط الدومين العام مع HTTPS.
- تشغيل Prisma migrations قبل الإطلاق.
- إعداد Cron Job كل 5 دقائق على `/api/room-preview/cleanup`.
- ضبط CORS على الـ Storage Bucket لنطاق التطبيق.
- اختبار النظام كاملاً قبل التسليم.

---

## 5. ENV المطلوبة

> ملف `.env.example` يحتوي أسماء جميع المتغيرات. القيم الحقيقية ترسل بقناة آمنة.

### ضرورية في الإنتاج 
- `GEMINI_API_KEY` | سري | ضروري | مفتاح Google Gemini API
- `ADMIN_USERNAME` | سري | اختياري | اسم مستخدم لوحة الإدارة (تعطيل اللوحة إذا فارغ)
- `ADMIN_PASSWORD` | سري | اختياري | كلمة مرور لوحة الإدارة

### ضرورية في الإنتاج 
- `DATABASE_URL` | سري | ضروري | رابط PostgreSQL (عبر الـ pooler)
- `DIRECT_URL` | سري | اختياري | رابط PostgreSQL المباشر (للـ migrations)
- `REDIS_URL` | سري | ضروري | رابط Redis
- `SESSION_TOKEN_SECRET` | سري | ضروري | 32-byte hex — أنشئه بـ `openssl rand -hex 32`
- `ADMIN_JWT_SECRET` | سري | ضروري | 32-byte hex — أنشئه بـ `openssl rand -hex 32`
- `CLEANUP_SECRET` | سري | ضروري | أي string عشوائي للحماية
- `CRON_SECRET` | سري | اختياري | يُضبط تلقائياً من Vercel، أو أنشئه يدوياً
- `NEXT_PUBLIC_BASE_URL` | عام | ضروري | الرابط العام للتطبيق (يؤثر على QR Code)
- `STORAGE_PROVIDER` | عادي | ضروري | `r2` أو `s3` (يرفض `local` في الإنتاج)
- `R2_ENDPOINT` | سري | مطلوب إذا R2 | رابط endpoint الـ R2
- `R2_ACCESS_KEY_ID` | سري | مطلوب إذا R2 | مفتاح وصول R2
- `R2_SECRET_ACCESS_KEY` | سري | مطلوب إذا R2 | مفتاح R2 السري
- `R2_BUCKET_NAME` | عادي | مطلوب إذا R2 | اسم الـ Bucket
- `R2_PUBLIC_URL` | عام | مطلوب إذا R2 | الرابط العام للـ Bucket

###
- `SESSION_EXPIRY_MINUTES` | عادي | اختياري | مدة الجلسة بالدقائق (افتراضي: 60)
- `MAX_RENDERS_PER_SESSION` | عادي | اختياري | أقصى عدد renders للجلسة (افتراضي: 2)
- `DATABASE_POOL_SIZE` | عادي | اختياري | حجم الـ pool (افتراضي: 5)
- `ENABLE_REDIS` | عادي | اختياري | `false` لتعطيل Redis (للتطوير فقط)
- `GEMINI_IMAGE_MODELS` | عادي | اختياري | قائمة models مفصولة بفواصل
- `GEMINI_MAX_CONCURRENT` | عادي | اختياري | أقصى طلبات Gemini متزامنة (افتراضي: 8)
- `ROOM_PREVIEW_DISABLE_RATE_LIMIT` | عادي | اختياري | `true` لتعطيل الـ rate limit (للتطوير فقط)
- `NEXT_PUBLIC_SENTRY_DSN` | عام | اختياري | DSN لـ Sentry (إذا مفعّل)
- `SENTRY_ORG` | عادي | اختياري | اسم organization في Sentry
- `SENTRY_PROJECT` | عادي | اختياري | اسم project في Sentry

---

## 6. أوامر التشغيل

```
npm install
npx prisma migrate deploy
npm run build
npm run start
```

> ملاحظة: `npm run build` يُشغّل `prisma generate` تلقائياً قبل الـ build.
> للتشغيل على شبكة LAN: `npm run start:lan` بدلاً من `npm run start`.

---

## 7. اختبار بعد الديبلويمنت
- [ ] فتح الشاشة الكبيرة والتحقق من ظهور QR Code بالرابط الصحيح.
- [ ] مسح QR من موبايل حقيقي والتحقق من الوصول للتطبيق.
- [ ] إدخال بيانات العميل واختيار نوع الجلسة.
- [ ] اختيار المنتج والتحقق من الحفظ في قاعدة البيانات.
- [ ] رفع صورة غرفة والتحقق من وصولها للـ Storage (R2/S3).
- [ ] تشغيل AI Render والانتظار حتى النتيجة (قد تصل 100 ثانية).
- [ ] التحقق من ظهور النتيجة على الموبايل والشاشة الكبيرة.
- [ ] التحقق من التزامن الفوري بين الموبايل والشاشة (SSE).
- [ ] مراجعة Logs والتحقق من غياب الأخطاء بعد أول render.
- [ ] التحقق من عمل Cron Job للتنظيف كل 5 دقائق.

---

## 8. ملاحظة الأسرار
- لا تُودَع الأسرار أو القيم الحقيقية داخل Git.
- هذا الملف وملف `.env.example` يحتويان أسماء فقط — بدون قيم.
- القيم السرية (API keys، passwords، tokens) ترسل عبر قناة آمنة.
- أي Secret غير موجود لدى المطوّر يجب أن يُنشئه فريق الديبلويمنت.
- عند أي متغير غير واضح، التواصل قبل التشغيل.
