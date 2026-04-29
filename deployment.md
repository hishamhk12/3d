# وثيقة تسليم النشر — نظام Room Preview

---

## 1. نظرة عامة على النظام

### ما هو النظام؟

نظام Room Preview هو تطبيق ويب يتيح لزوار المعرض معاينة مواد الأرضيات داخل غرفتهم الحقيقية باستخدام الذكاء الاصطناعي. يعمل النظام على شاشة ثابتة في صالة العرض ويتحكم فيه الزائر من خلال هاتفه المحمول عبر رمز QR.

### تدفق العمل الكامل

```
شاشة المعرض (TV/Monitor)
  └─ تعرض رمز QR ورابط الجلسة
       │
       ▼
الزائر يمسح الرمز بهاتفه
  └─ يفتح صفحة بوابة الدخول (gate)
       │
       ▼
بوابة الدخول (gate form)
  └─ يدخل الاسم والدور (عميل / موظف)
       │
       ▼
صفحة الجلسة على الهاتف (mobile session)
  ├─ يختار مصدر الغرفة: كاميرا أو معرض الصور أو غرفة تجريبية
  ├─ يرفع صورة الغرفة → ترفع إلى التخزين (R2/S3 أو محلي)
  └─ يختار المنتج (بالكود أو الباركود)
       │
       ▼
طلب الرندر
  └─ يُرسل الطلب إلى Gemini API
  └─ يُنتج صورة مدمجة (المنتج داخل الغرفة)
       │
       ▼
النتيجة
  ├─ تظهر على هاتف العميل
  └─ تُعرض بشكل كامل الشاشة على TV المعرض
```

### التقنيات المستخدمة

| المكوّن | التقنية |
|---|---|
| إطار العمل | Next.js 16.2.1 (App Router) |
| واجهة المستخدم | React 19 |
| قاعدة البيانات | PostgreSQL + Prisma 7.6 |
| الذكاء الاصطناعي | Google Gemini (gemini-2.5-flash-image) |
| التخزين | محلي في التطوير — R2/S3 إلزامي في الإنتاج |
| الوقت الفعلي | SSE (Server-Sent Events) + Redis Pub/Sub (اختياري) |
| المراقبة | Sentry (اختياري) |

---

## 2. المتطلبات الأساسية

### Node.js

- الحد الأدنى المطلوب: **Node.js 20 LTS**
- الموصى به: **Node.js 22 LTS** أو أحدث
- للتحقق: `node --version`

### PostgreSQL

- الإصدار الموصى به: PostgreSQL 15 أو أحدث
- يدعم النظام الاتصال المباشر والاتصال عبر connection pooler (PgBouncer، Supabase Supavisor، Neon)
- يجب توفير اتصالين: رابط pooled لطلبات التطبيق، ورابط مباشر للـ migrations

### Redis (اختياري لكن موصى به في الإنتاج)

- الإصدار المطلوب: Redis 6 أو أحدث
- يُستخدم للـ SSE pub/sub عبر instances متعددة، وللـ rate limiting، وقفل التزامن
- خدمات السحابة المدعومة: Upstash، Redis Cloud، أو خادم Redis مخصص
- عند استخدام Upstash يجب استخدام رابط `rediss://` (مع TLS) لا `redis://`

### Gemini API

- مطلوب حساب Google Cloud مع تفعيل Gemini API
- النماذج المستخدمة افتراضياً: `gemini-2.5-flash-image` و `gemini-3.1-flash-image-preview`
- يُجرب النظام النماذج بالترتيب ويُعيد المحاولة 3 مرات عند الفشل

### التخزين السحابي (إلزامي في الإنتاج)

- مدعوم: Cloudflare R2، أو AWS S3، أو أي خدمة متوافقة مع S3 API
- التخزين المحلي **سيوقف التطبيق عند الإقلاع في بيئة الإنتاج** — لا يمكن تجاهل هذا الشرط

---

## 3. إعداد متغيرات البيئة

### قاعدة البيانات

```
# رابط الاتصال عبر connection pooler (للتطبيق)
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require

# رابط الاتصال المباشر (للـ migrations فقط)
DIRECT_URL=postgresql://user:password@direct-host:5432/dbname?sslmode=require
```

عند استخدام Supabase أو Neon، يوفر كل منهما رابطين منفصلين: رابط pooled ورابط direct. استخدم الـ pooled في `DATABASE_URL` والـ direct في `DIRECT_URL`.

### مفاتيح الأمان

يجب توليد كل مفتاح بشكل مستقل. لا تستخدم نفس القيمة لأكثر من متغير.

```
# مفتاح توقيع توكن الجلسة (HMAC)
SESSION_TOKEN_SECRET=<openssl rand -hex 32>

# مفتاح توقيع كوكي لوحة الإدارة (HMAC)
ADMIN_JWT_SECRET=<openssl rand -hex 32>

# سر نقطة تنظيف الجلسات (cron endpoint)
CLEANUP_SECRET=<openssl rand -hex 32>
```

لتوليد كل قيمة:
```bash
openssl rand -hex 32
```

### Gemini API

```
# مفتاح Google Gemini API
GEMINI_API_KEY=AIza...

# اختياري: تحديد النماذج يدوياً (مفصولة بفواصل)
# GEMINI_IMAGE_MODELS=gemini-2.5-flash-image,gemini-3.1-flash-image-preview
```

### الرابط العام للتطبيق

```
# الرابط الكامل للتطبيق (بدون slash في النهاية) — يُستخدم لتوليد رموز QR
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

هذا المتغير يُضاف في رابط QR الذي يمسحه الزائر. إذا كان خاطئاً، لن تعمل رموز QR.

### بيانات لوحة الإدارة

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<كلمة مرور قوية>
```

### التخزين

```
# "local" للتطوير فقط | "r2" أو "s3" للإنتاج
STORAGE_PROVIDER=r2

# Cloudflare R2
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2 Access Key>
R2_SECRET_ACCESS_KEY=<R2 Secret Key>
R2_BUCKET_NAME=room-preview
R2_PUBLIC_URL=https://cdn.your-domain.com
```

`R2_PUBLIC_URL` هو الرابط العام للبكت — يمكن أن يكون رابط R2 الافتراضي (`*.r2.dev`) أو نطاق مخصص متصل بـ CDN.

### Redis (اختياري لكن موصى به)

```
# رابط Redis — أوقف التعليق عند التفعيل
REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6380

# اضبط على "false" لتعطيل Redis يدوياً دون حذف REDIS_URL
# ENABLE_REDIS=false
```

### متغيرات إضافية

```
# مدة صلاحية الجلسة بالدقائق (افتراضي: 60)
# SESSION_EXPIRY_MINUTES=60

# حجم pool اتصالات قاعدة البيانات (افتراضي: 5)
# قلّل إلى 1-2 عند استخدام connection pooler خارجي
# DATABASE_POOL_SIZE=5
```

---

### ملف `.env.example` الكامل

```env
# ─── قاعدة البيانات ────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
DIRECT_URL=postgresql://user:password@direct-host:5432/dbname?sslmode=require

# ─── مفاتيح الأمان ────────────────────────────────────────────────────────────
# توليد كل قيمة بشكل منفصل: openssl rand -hex 32
SESSION_TOKEN_SECRET=
ADMIN_JWT_SECRET=
CLEANUP_SECRET=

# ─── الرابط العام ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_BASE_URL=https://your-domain.com

# ─── الإدارة ──────────────────────────────────────────────────────────────────
ADMIN_USERNAME=admin
ADMIN_PASSWORD=

# ─── Gemini API ────────────────────────────────────────────────────────────────
GEMINI_API_KEY=
# GEMINI_IMAGE_MODELS=gemini-2.5-flash-image,gemini-3.1-flash-image-preview

# ─── التخزين ──────────────────────────────────────────────────────────────────
STORAGE_PROVIDER=r2
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=room-preview
R2_PUBLIC_URL=https://cdn.your-domain.com

# ─── Redis (موصى به في الإنتاج) ───────────────────────────────────────────────
REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6380
# ENABLE_REDIS=false

# ─── اختياري ──────────────────────────────────────────────────────────────────
# SESSION_EXPIRY_MINUTES=60
# DATABASE_POOL_SIZE=5
```

---

## 4. خطوات التشغيل

### بيئة التطوير المحلي

```bash
# 1. تثبيت الحزم
npm install

# 2. إنشاء ملف البيئة
cp .env.example .env.local
# ثم أضف القيم المطلوبة في .env.local

# 3. توليد Prisma Client
npx prisma generate

# 4. تشغيل الـ migrations على قاعدة البيانات
npx prisma migrate dev

# 5. تشغيل خادم التطوير
npm run dev
```

لتشغيل الخادم مرئياً من أجهزة أخرى على نفس الشبكة (الجوال مثلاً):
```bash
npm run dev:lan
# ثم اكتشف عنوان IP بـ:
npm run dev:ip
```

### بيئة الإنتاج

```bash
# 1. تثبيت الحزم
npm install

# 2. تشغيل الـ migrations (اتصال مباشر عبر DIRECT_URL)
npx prisma migrate deploy

# 3. بناء التطبيق
npm run build
# يشمل: prisma generate + next build

# 4. تشغيل الخادم
npm start
```

ملاحظة: أمر `npm run build` يُشغّل `prisma generate` تلقائياً. لا حاجة لتشغيله يدوياً قبل البناء.

---

## 5. إعداد قاعدة البيانات

### إنشاء قاعدة البيانات

يمكن استخدام أي مزود PostgreSQL: Supabase، Neon، Railway، أو خادم مخصص.

**Supabase (موصى به للبداية):**
1. أنشئ مشروعاً جديداً على supabase.com
2. اذهب إلى Settings → Database → Connection string
3. انسخ **Transaction pooler** إلى `DATABASE_URL`
4. انسخ **Direct connection** إلى `DIRECT_URL`

**Neon:**
1. أنشئ مشروعاً جديداً على neon.tech
2. انسخ **Pooled connection** إلى `DATABASE_URL`
3. انسخ **Direct connection** إلى `DIRECT_URL`

### ربط Prisma

يستخدم النظام `@prisma/adapter-pg` مع مجموعة اتصالات `pg.Pool`. الاتصال يحدث تلقائياً عند أول طلب.

```bash
# توليد Prisma Client (يجب تشغيله بعد كل تغيير في schema.prisma)
npx prisma generate

# تطبيق الـ migrations (للإنتاج — لا يُعدّل schema، فقط يُطبّق)
npx prisma migrate deploy

# إنشاء migration جديد (للتطوير فقط)
npx prisma migrate dev --name <اسم_التغيير>

# استعراض قاعدة البيانات
npx prisma studio
```

### عدد الاتصالات الموصى به

| البيئة | `DATABASE_POOL_SIZE` |
|---|---|
| Vercel Serverless + Supabase pooler | 1–2 |
| Vercel Serverless + Neon pooler | 1–2 |
| خادم مخصص (VPS) بدون pooler | 3–5 |
| خادم مخصص مع PgBouncer | 1–2 |

---

## 6. رفع المشروع (Deployment)

### Vercel (الخيار الموصى به)

1. ربط المستودع بـ Vercel
2. إضافة جميع متغيرات البيئة من قسم 3 في لوحة تحكم Vercel
3. في إعدادات Build Command: `npm run build` (الافتراضي)
4. في إعدادات Output Directory: `.next` (الافتراضي)
5. الكرون الموجود في `vercel.json` يُشغّل تلقائياً:

```json
{
  "crons": [
    {
      "path": "/api/room-preview/cleanup",
      "schedule": "0 3 * * *"
    }
  ]
}
```

هذا الكرون ينظف الجلسات المنتهية الصلاحية والعمليات العالقة يومياً عند الساعة 3 صباحاً. يجب ضبط `CLEANUP_SECRET` قبل النشر.

### Railway

1. أنشئ خدمة من المستودع
2. أضف خدمة PostgreSQL من لوحة Railway
3. اضبط `DATABASE_URL` و `DIRECT_URL` من بيانات اتصال Railway
4. أضف باقي متغيرات البيئة
5. Railway يُشغّل `npm run build` ثم `npm start` تلقائياً

لضبط الكرون على Railway، استخدم Cron Job service منفصلة تستدعي نقطة `/api/room-preview/cleanup` مع header `x-cleanup-secret`.

### VPS (Ubuntu/Debian)

```bash
# تثبيت Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# استنساخ المشروع
git clone <repo-url> /var/www/room-preview
cd /var/www/room-preview

# إعداد البيئة
cp .env.example .env
nano .env  # أضف جميع القيم

# التثبيت والبناء
npm install
npx prisma migrate deploy
npm run build

# التشغيل مع PM2
npm install -g pm2
pm2 start "npm start" --name room-preview
pm2 save
pm2 startup
```

استخدم Nginx أو Caddy كـ reverse proxy أمام منفذ 3000.

### تحذيرات مهمة عند النشر

- **التخزين المحلي محظور في الإنتاج:** إذا كان `STORAGE_PROVIDER` غير مضبوط أو مضبوط على `local`، سيرمي التطبيق خطأ فور الإقلاع ولن يعمل. يجب ضبط `STORAGE_PROVIDER=r2` مع جميع متغيرات `R2_*` قبل النشر.
- **SESSION_TOKEN_SECRET إلزامي:** بدونه في الإنتاج، يرمي الخادم خطأ ويرفض الإقلاع.
- **NEXT_PUBLIC_BASE_URL يجب أن يطابق النطاق الفعلي:** أي خطأ في هذا الرابط يُبطل جميع رموز QR.

---

## 7. التخزين

### لماذا التخزين المحلي غير مناسب للإنتاج؟

التخزين المحلي يكتب الملفات على `public/uploads/` داخل نظام ملفات الخادم نفسه. هذا يخلق ثلاث مشاكل:

1. **فقدان الملفات عند النشر:** كل deployment جديد ينشئ container جديداً فارغاً. جميع الصور المرفوعة تُفقد.
2. **عدم المشاركة بين الـ instances:** في بيئات serverless كـ Vercel، كل طلب قد يُخدَّم من instance مختلفة. الصورة المرفوعة على instance A غير مرئية على instance B.
3. **لا CDN:** الصور تُخدَّم مباشرةً من عملية Node.js بدون أي شبكة توزيع — ضعيف للأداء.

### إعداد Cloudflare R2 (الأسهل والأوفر)

1. أنشئ حساباً على Cloudflare
2. من لوحة التحكم → R2 → Create bucket
3. أنشئ API Token من: My Profile → API Tokens → Create Token → R2 permissions
4. من لوحة البكت: Settings → Public Access → Enable
5. اختيارياً: ربط نطاق مخصص كـ `cdn.your-domain.com` عبر إعدادات Custom Domains

```env
STORAGE_PROVIDER=r2
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<من API Token>
R2_SECRET_ACCESS_KEY=<من API Token>
R2_BUCKET_NAME=room-preview
R2_PUBLIC_URL=https://<بكت>.r2.dev
# أو عند استخدام نطاق مخصص:
# R2_PUBLIC_URL=https://cdn.your-domain.com
```

### إعداد AWS S3

```env
STORAGE_PROVIDER=s3
R2_ENDPOINT=https://s3.<region>.amazonaws.com
R2_ACCESS_KEY_ID=<AWS Access Key>
R2_SECRET_ACCESS_KEY=<AWS Secret Key>
R2_BUCKET_NAME=room-preview-bucket
R2_PUBLIC_URL=https://room-preview-bucket.s3.<region>.amazonaws.com
```

تأكد من ضبط Bucket Policy لتفعيل Public Read Access، وإضافة CORS rule تسمح بـ `GET` من النطاق الخاص بالتطبيق.

---

## 8. Redis

### متى تحتاج Redis؟

Redis مطلوب عند النشر في بيئة **serverless أو multi-instance** (Vercel، عدة servers). يوفر Redis ثلاث وظائف:

| الوظيفة | بدون Redis | مع Redis |
|---|---|---|
| SSE Pub/Sub | أحداث الجلسة لا تنتقل بين الـ instances | الأحداث تصل فوراً لجميع الـ instances |
| Rate Limiting | كل instance يحسب بشكل مستقل (يمكن التحايل) | حساب موحد عبر جميع الـ instances |
| قفل التزامن (render lock) | احتمال تشغيل رندرين بالتوازي | قفل موزع يمنع التكرار |

### متى يمكن الاستغناء عن Redis؟

- عند التشغيل على **خادم واحد** (single process، VPS واحد)
- في بيئة **التطوير المحلي**

في هذه الحالة، اضبط `ENABLE_REDIS=false` في ملف البيئة. سيستخدم التطبيق بدائل داخلية (in-process) بدون أي تأثير على الوظائف الأساسية.

### إعداد Upstash (الأسهل للـ serverless)

1. أنشئ حساباً على upstash.com
2. أنشئ قاعدة بيانات Redis جديدة
3. اختر **TLS enabled** إلزامياً
4. انسخ **Redis URL** بصيغة `rediss://`

```env
REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6380
```

تحذير: لا تستخدم `redis://` (بدون TLS) مع Upstash — الاتصال يكون غير مشفر على الشبكة العامة. الكود يُطلق تحذيراً عند رصد هذا الخطأ.

---

## 9. المشاكل المعروفة والقيود

### 1. SSE بدون Redis محدود ببيئة single-process

عند تعطيل Redis، تستخدم أحداث الجلسة (SSE) قناة pub/sub داخل عملية Node.js الواحدة. في بيئات serverless حيث قد يُخدَّم طلب الموبايل وطلب الشاشة من instances مختلفة، لن تصل أحداث الشاشة إلى الموبايل والعكس. النتيجة: الشاشة لن تُحدَّث تلقائياً وستنتقل إلى وضع polling كل 2 ثانية.

**الحل:** تفعيل Redis.

### 2. ضغط على قاعدة البيانات من نظام التشخيص

كل إجراء في الجلسة (رفع صورة، اختيار منتج، رندر) يكتب سطراً في جدول `session_events`. في بيئة الإنتاج مع حركة مرور عالية، قد يتراكم هذا الجدول بسرعة.

**التوصية:** تشغيل cleanup API بانتظام (موجود في vercel.json). مراقبة حجم الجداول وإضافة archiving policy عند الحاجة.

### 3. تأخر الرندر

يأخذ Gemini ما بين 30 و 90 ثانية لإنتاج الصورة. خلال هذا الوقت:
- الموبايل يعرض شاشة انتظار ويتابع بـ polling بمعدل متصاعد (2.5 ثانية → 5 ثوان → 10 ثوان)
- المهلة القصوى للانتظار: 310 ثانية

إذا تجاوز الرندر المهلة، يُوقف التطبيق العملية ويُبلّغ عن الخطأ. هذا سلوك متوقع عند ضغط عالي على Gemini.

### 4. الجلسات العالقة

إذا انتهت عملية الرندر بدون تحديث قاعدة البيانات (مثل crash)، تبقى الجلسة في حالة `rendering` إلى الأبد. cleanup API يُحدّد الجلسات العالقة بعد 7 دقائق ويُحوّلها إلى `failed`.

يجب التأكد من تشغيل cleanup بانتظام (كرون يومي في Vercel، أو cron job منفصل في بيئات أخرى).

### 5. حجم pool الاتصالات

الافتراضي 5 اتصالات. في Vercel حيث تعمل دوال serverless بالتوازي، قد يصل عدد الاتصالات المتزامنة إلى `عدد الـ instances × 5`. مع connection pooler (Supabase Supavisor أو Neon Pooler) قلّل `DATABASE_POOL_SIZE` إلى 1 أو 2.

### 6. رفع الصور على الشبكة المحلية

في بيئة التطوير، رفع صور ذات حجم كبير على شبكة Wi-Fi بطيئة قد يُسبّب timeout. المهلة الافتراضية 90–120 ثانية مع آلية استرداد تلقائي: إذا انتهت مهلة العميل لكن الخادم أتمّ الرفع، يُكتشف الملف عبر polling ويُسترد بدون إعادة رفع.

---

## 10. Checklist قبل التشغيل في الإنتاج

```
المتطلبات الأساسية
[ ] Node.js 20+ مثبّت
[ ] PostgreSQL متاح ومتصل
[ ] قاعدة البيانات منشأة ومتغيرات الاتصال صحيحة

متغيرات البيئة
[ ] DATABASE_URL محدد وصحيح
[ ] DIRECT_URL محدد (للـ migrations)
[ ] SESSION_TOKEN_SECRET مولّد (openssl rand -hex 32)
[ ] ADMIN_JWT_SECRET مولّد (openssl rand -hex 32)
[ ] CLEANUP_SECRET مولّد (openssl rand -hex 32)
[ ] NEXT_PUBLIC_BASE_URL يطابق النطاق الفعلي (بدون / في النهاية)
[ ] ADMIN_USERNAME و ADMIN_PASSWORD محددان
[ ] GEMINI_API_KEY صحيح ومفعّل
[ ] STORAGE_PROVIDER=r2 وجميع متغيرات R2_* محددة
[ ] REDIS_URL محدد (مع rediss:// إذا Upstash)

قاعدة البيانات
[ ] npx prisma migrate deploy نجح بدون أخطاء
[ ] جميع الـ migrations مُطبّقة

البناء والنشر
[ ] npm run build نجح بدون أخطاء TypeScript
[ ] الكرون /api/room-preview/cleanup مضبوط وسيعمل بانتظام
[ ] CLEANUP_SECRET مضبوط في headers الكرون

التخزين
[ ] البكت موجود وPublic Access مفعّل
[ ] R2_PUBLIC_URL صحيح ويمكن الوصول إليه من المتصفح

اختبار سريع بعد النشر
[ ] فتح /room-preview على شاشة المعرض — يظهر رمز QR
[ ] مسح رمز QR من الهاتف — يفتح صفحة البوابة
[ ] إكمال النموذج — ينتقل إلى صفحة الجلسة
[ ] رفع صورة غرفة — تظهر الصورة بنجاح
[ ] اختيار منتج — يُحفظ
[ ] طلب رندر — ينتج نتيجة
[ ] النتيجة تظهر على الشاشة والهاتف
[ ] لوحة الإدارة /admin تعمل ببيانات الدخول الصحيحة
```

---

## 11. ملاحظات مهمة

### حماية المفاتيح والأسرار

- **لا ترفع ملف `.env` أو `.env.local` إلى Git تحت أي ظرف.** تأكد من وجودهما في `.gitignore`.
- لا تضع أي مفتاح API أو كلمة مرور مباشرةً في الكود أو في ملفات الإعداد المخصصة للـ version control.
- استخدم لوحة تحكم المنصة (Vercel Dashboard أو Railway Variables) لإدارة متغيرات الإنتاج.
- غيّر `ADMIN_PASSWORD` من قيمته الافتراضية قبل أول نشر.
- جميع المفاتيح الثلاثة (`SESSION_TOKEN_SECRET`، `ADMIN_JWT_SECRET`، `CLEANUP_SECRET`) يجب أن تكون قيماً مختلفة ومولّدة بشكل عشوائي.

### رؤوس الأمان

التطبيق يُضيف رؤوس أمان تلقائياً في الإنتاج:

- `Strict-Transport-Security` — يُجبر HTTPS فقط
- `X-Frame-Options: DENY` — يمنع تضمين الموقع في iframe
- `X-Content-Type-Options: nosniff` — يمنع تخمين MIME types
- `Referrer-Policy` — يحمي من تسريب بيانات الجلسة للخدمات الخارجية
- `Permissions-Policy` — يُغلق الوصول إلى الكاميرا والميكروفون (غير مطلوبَين على شاشة المعرض)

### Sentry (اختياري)

إذا أردت تفعيل مراقبة الأخطاء:

```env
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

بدون هذين المتغيرين يعمل Sentry في وضع صامت بدون إرسال أي أحداث.

### تحديث التطبيق

عند كل إصدار جديد يتضمن تغييرات في `schema.prisma`:

1. شغّل `npx prisma migrate deploy` **قبل** رفع البناء الجديد
2. تأكد من نجاح الـ migrations ثم أكمل النشر

عدم اتباع هذا الترتيب قد يُسبّب أخطاء في البنية عند تشغيل الكود الجديد على schema قديم.
