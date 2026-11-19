# نُبذة — nubthah.com

هذا المخزن هو **المصدر الوحيد** لموقع نُبذة (منشئ السير الذاتية وبطاقات الأعمال).
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
- حساب Cloudflare: dev.rayanalgh@gmail.com (حساب ريان الخاص). الدومين مسجّل في Namecheap والـ Nameservers على Cloudflare. لا تستخدم أي حساب يخص جمعة.
- الواجهة عربية، والردود على ريان بالعربي دائمًا.
