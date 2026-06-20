# نظرة عامة

هذا المشروع يجمع بين:

* نظام عرض المنتجات داخل صور الغرف.
* ربط شاشة المعرض بجوال العميل عن طريق QR.
* دخول البائع واستخدام شات المخزون.
* لوحة إدارة لمتابعة النظام والشات بوت والتحكم بالإعدادات الأساسية.

# أنواع المستخدمين

* العميل الجديد: يدخل بياناته قبل بدء التجربة.
* العميل الحالي: يتم التعرف عليه من بياناته السابقة.
* الموظف: يستخدم التجربة داخل المعرض بدون بيانات عميل كاملة.
* البائع: يدخل إلى شات المخزون عبر كود البائع وكود المعرض وكلمة المرور.
* الأدمن: يدير الشاشات والجلسات والبائعين والمعارض والشات بوت.

# فلو العميل

1. فتح النظام على شاشة المعرض من صفحة `/room-preview/screen`.
2. إنشاء جلسة جديدة من خلال `/api/room-preview/sessions`.
3. ظهور QR على شاشة المعرض.
4. مسح QR من جوال العميل.
5. فتح صفحة الجوال وربطها بالجلسة.
6. اختيار نوع المستخدم: عميل جديد، عميل حالي، أو موظف.
7. إدخال بيانات العميل عند الحاجة.
8. رفع صورة الغرفة من الجوال.
9. اختيار المنتج أو مسح كود المنتج.
10. إرسال طلب المعالجة.
11. معالجة الصورة بالذكاء الاصطناعي.
12. ظهور النتيجة على الجوال وشاشة المعرض.
13. إنهاء الجلسة أو بدء تجربة جديدة.

حالات الجلسة الأساسية:

* `waiting_for_mobile`: بانتظار اتصال الجوال.
* `mobile_connected`: تم اتصال الجوال.
* `room_selected`: تم اختيار أو رفع صورة الغرفة.
* `product_selected`: تم اختيار المنتج.
* `ready_to_render`: الجلسة جاهزة للمعالجة.
* `rendering`: المعالجة جارية.
* `result_ready`: النتيجة جاهزة.
* `completed`: الجلسة اكتملت.
* `failed`: حدث فشل.
* `expired`: انتهت الجلسة.

# فلو البائع

1. اختيار الدخول كبائع من صفحة `/login?type=seller`.
2. إدخال كود البائع وكود المعرض وكلمة المرور.
3. التحقق من البائع والمعرض وحالة الحساب.
4. إنشاء جلسة بائع آمنة في Cookie باسم `seller_session`.
5. فتح صفحة شات البائع `/seller/chat`.
6. كتابة سؤال عن منتج أو مخزون أو مستودع.
7. إرسال الطلب من تطبيق 3d إلى مسار `/api/seller/chat`.
8. تطبيق 3d يرسل الطلب إلى FastAPI من السيرفر فقط.
9. FastAPI يقرأ بيانات المخزون من قاعدة بيانات الشات بوت.
10. إعادة الإجابة المنظمة إلى واجهة البائع.
11. دعم اقتراحات أكواد المنتجات من `/api/seller/inventory/code-suggestions`.
12. دعم الأسئلة المتتابعة حسب آخر سياق للمنتج.
13. تسجيل الخروج وإنهاء جلسة البائع من `/api/seller/auth/logout`.

# فلو الشات بوت

* تطبيق 3d لا يقرأ قاعدة بيانات الشات بوت مباشرة.
* تطبيق 3d يتصل بخدمة FastAPI عن طريق `CHATBOT_FASTAPI_URL`.
* يتم إنشاء JWT قصير العمر وآمن بين 3d وFastAPI.
* شات البائع يستخدم `EXTERNAL_SELLER_JWT_SECRET`.
* مسارات الأدمن نحو FastAPI تستخدم `INTERNAL_JWT_SECRET`.
* FastAPI يتحقق من هوية البائع أو الأدمن.
* FastAPI يقرأ بيانات المخزون من قاعدة بيانات الشات بوت.
* يتم إرجاع جواب منظم إلى واجهة البائع.
* عند عدم وجود بيانات كافية، لا يتم اختراع معلومات.

# فلو الأدمن

* تسجيل دخول الأدمن من `/admin/login`.
* إدارة الشاشات والجلسات من لوحة `/admin`.
* متابعة الجلسات، الرندر، الأخطاء، والتشخيصات.
* إدارة البائعين من صفحة `/admin/chatbot`.
* إدارة المعارض من صفحة `/admin/chatbot`.
* صفحة إدارة الشات بوت تحتوي على:
  * Overview
  * Inventory Import
  * Sellers
  * Showrooms
  * Activity
  * Settings & Status
* عرض حالة الخدمات مثل FastAPI، قاعدة البيانات، Gemini، والمخزون.
* متابعة الاستيراد والنشاط والإعدادات.
* إدارة بيانات الإكسل أو مصدر المخزون عند الحاجة عبر فلو Preview ثم Confirm.

# قواعد البيانات

المشروع يستخدم قاعدتي بيانات منفصلتين.

## قاعدة بيانات 3d

تستخدم لـ:

* البائعين.
* المعارض.
* جلسات البائعين.
* جلسات العرض.
* العملاء.
* تجارب العملاء السابقة.
* الشاشات.
* وظائف الرندر.
* أحداث الجلسات ومشاكلها.
* بيانات نظام Room Preview.

## قاعدة بيانات الشات بوت

تستخدم لـ:

* بيانات المخزون.
* المنتجات.
* رسائل الشات.
* سجلات الاستيراد.
* نسخ احتياطية من المخزون.
* بيانات الشات بوت.

لا يتم وضع كلمات مرور أو روابط اتصال كاملة أو أسرار داخل هذا الملف.

# الخدمات والاستضافة

* تطبيق 3d مستضاف على Vercel.
* FastAPI مستضاف على Render.
* قاعدة البيانات مستضافة على Supabase.
* Redis / Upstash يستخدم للحالة اللحظية، القفل، التحديثات، والحدود.
* تخزين الصور يتم عن طريق Cloudflare R2.
* خدمة الذكاء الاصطناعي تستخدم Google Gemini.

# التقنيات المستخدمة

* Next.js: تطبيق الويب وواجهات API في مشروع 3d.
* React: بناء واجهات المستخدم.
* TypeScript: كتابة كود 3d بشكل typed.
* Tailwind CSS: تنسيق الواجهات.
* Prisma: التعامل مع قاعدة بيانات 3d.
* PostgreSQL: قاعدة البيانات الأساسية.
* Supabase: استضافة PostgreSQL.
* FastAPI: خدمة الشات بوت والمخزون.
* Python: لغة خدمة FastAPI.
* SQLAlchemy: اتصال FastAPI بقاعدة بيانات الشات بوت.
* Redis / Upstash: القفل، التحديثات اللحظية، والحدود.
* Cloudflare R2: تخزين صور الغرف والنتائج.
* Google Gemini: معالجة الصور وشات المخزون عند توفر المفتاح.
* JWT: تأمين جلسات البائع والاتصال بين 3d وFastAPI.
* Vercel: استضافة تطبيق 3d.
* Render: استضافة FastAPI.
* Vitest: اختبارات TypeScript.
* Pytest: اختبارات Python.
* Playwright: اختبارات E2E.
* Fluent UI: واجهات لوحة إدارة الشات بوت.
* AWS SDK S3: رفع الصور إلى R2.
* Pino: تسجيل السيرفر.
* Sentry: مراقبة الأخطاء.
* Zod: التحقق من مدخلات الواجهات وAPI.
* QRCode / qr-scanner: إنشاء ومسح QR.

# متغيرات البيئة الرئيسية

لا يحتوي هذا القسم على أي قيم.

## تطبيق 3d

* `DATABASE_URL`
* `DIRECT_URL`
* `DATABASE_POOL_SIZE`
* `NEXT_PUBLIC_BASE_URL`
* `SELLER_SESSION_SECRET`
* `SELLER_CHAT_ENABLED`
* `CHATBOT_FASTAPI_URL`
* `INTERNAL_JWT_SECRET`
* `EXTERNAL_SELLER_JWT_SECRET`
* `SESSION_TOKEN_SECRET`
* `ADMIN_JWT_SECRET`
* `ADMIN_USERNAME`
* `ADMIN_PASSWORD`
* `CLEANUP_SECRET`
* `CRON_SECRET`
* `REDIS_URL`
* `ENABLE_REDIS`
* `STORAGE_PROVIDER`
* `R2_ENDPOINT`
* `R2_ACCESS_KEY_ID`
* `R2_SECRET_ACCESS_KEY`
* `R2_BUCKET_NAME`
* `R2_PUBLIC_URL`
* `GEMINI_API_KEY`
* `GEMINI_IMAGE_MODELS`
* `GEMINI_MAX_CONCURRENT`
* `GEMINI_CALL_TIMEOUT_MS`
* `SESSION_EXPIRY_MINUTES`
* `MAX_RENDERS_PER_SESSION`
* `ROOM_PREVIEW_DISABLE_RATE_LIMIT`
* `NEXT_PUBLIC_SENTRY_DSN`
* `SENTRY_ORG`
* `SENTRY_PROJECT`

## FastAPI

* `PY_DATABASE_URL`
* `INTERNAL_JWT_SECRET`
* `EXTERNAL_SELLER_JWT_SECRET`
* `APP_ENV`
* `GEMINI_API_KEY`
* `GEMINI_MODEL`
* `CHAT_DEBUG`
* `AI_WEB_KNOWLEDGE_ENABLED`
* `TAVILY_API_KEY`
* `AI_LANGCHAIN_ENABLED`
* `AI_VOICE_INPUT_ENABLED`
* `VOICE_MAX_BYTES`
* `TECHNICAL_RAG_ENABLED`
* `TECHNICAL_RAG_SHADOW_MODE`
* `EMBEDDING_MODEL`
* `EMBEDDING_DIM`

# مخطط الاتصال المختصر

`شاشة المعرض → QR → جوال العميل → تطبيق 3d → Gemini → النتيجة`

`البائع → تطبيق 3d → FastAPI → قاعدة بيانات الشات بوت → الإجابة`

`الأدمن → لوحة الإدارة → تطبيق 3d / FastAPI / قواعد البيانات`

# ملاحظات مهمة

* قاعدة بيانات 3d منفصلة عن قاعدة بيانات الشات بوت.
* أسرار JWT بين Vercel وRender يجب أن تكون متطابقة عند الحاجة.
* `SELLER_SESSION_SECRET` خاص بجلسات البائع ولا يجب أن يكون قصيراً.
* لا يجب وضع الأسرار داخل الكود أو داخل هذا الملف.
* الشات يعتمد على تشغيل FastAPI.
* تغييرات Environment Variables تحتاج Deployment جديد.
