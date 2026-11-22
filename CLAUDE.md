# نُبذة — nubthah.com

هذا المخزن هو **المصدر الوحيد** لموقع نُبذة (منشئ السير الذاتية وبطاقات الأعمال).
المخزن: **github.com/nubthah/nubthah-site** (منظمة نُبذة في GitHub، مالكها حساب Rayanalgh). انتقل من Rayanalgh/nubthah-site في ٢٠٢٦-١١-٢٣، والرابط القديم يحوّل تلقائيًا.
Cloudflare مربوط فيه (Workers Builds للـ Worker `nubthah`): أي push على `main` ينشر الموقع تلقائيًا خلال دقيقة.

## الملفات
- `public/index.html` — الموقع كامل (الرئيسية + صفحة التصميم + فحص ATS + صفحة الباركود). ملف واحد.
- `src/worker.js` — سيرفر صغير لـ `/api` فقط: الكلمات المفتاحية وترتيب السيرة بالذكاء الاصطناعي، وتسجيل الدخول بـ Google.
- `wrangler.toml` — إعدادات Cloudflare والدومين.

## قواعد
- عدّل وارفع على `main` مباشرة، وبعد الـ push تأكد من البناء في Cloudflare ← Workers & Pages ← nubthah ← Deployments، وجرّب الموقع.
- لا ترفع أي مفتاح أو سر. الأسرار (ANTHROPIC_API_KEY, SESSION_SECRET) محفوظة في Cloudflare فقط.
- لا تغيّر DNS أو إعدادات Cloudflare/Namecheap بدون موافقة ريان.
- الإيميل على الدومين يتحوّل عن طريق Cloudflare Email Routing: info@nubthah.com و help@nubthah.com ← nubthah.app@gmail.com (إيميل نُبذة). لا تحذف سجلات MX/SPF/DKIM/DMARC اللي حطها Cloudflare.
- كل شيء يخص نُبذة تحت إيميل نُبذة: حساب Cloudflare هو **Nubthah.app@gmail.com's Account** (id 385a91a95ad5eb02406bb8b5d2b0aaa9)، والـ Nameservers فيه aaron و sloan. الدومين مسجّل في Namecheap. لا تستخدم حساب dev.rayanalgh القديم ولا أي حساب يخص جمعة.
- قاعدة البيانات D1 اسمها `nubthah` (الحسابات والسير)، وتنشأ جداولها تلقائيًا من `src/worker.js`.
- الأسرار في Cloudflare فقط: ANTHROPIC_API_KEY، RESEND_API_KEY (رموز التحقق بالإيميل)، و SESSION_SECRET اختياري. GOOGLE_CLIENT_ID متغير عادي في wrangler.toml.
- الواجهة عربية، والردود على ريان بالعربي دائمًا.
