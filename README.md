# Orbithub

نطاق مستقل (`orbithub.hostaka.fun`) يخدّم فقط صفحتي الدردشة والمجموعات
من هوستاكا، كمنتج فرعي منفصل بمستودعه الخاص وسيرفره الخاص.

## البنية

سيرفر **Express حقيقي** (`server.js`) — نفس نمط المشروع الرئيسي بالضبط:

```
orbithub/
├── server.js          ← السيرفر (static + بروكسي /api)
├── package.json
├── vercel.json         ← نفس نمط builds/routes حق المشروع الرئيسي
├── .env.example
└── public/
    ├── chat.html / chat.css / chat.js
    ├── group.html / group.css / group.js
    ├── theme.css / shared.css / shared.js
    ├── emoji.css / emoji.js / emoji-catalog.json
    ├── i18n.js / modal.js / crypto.js / protect.js
    ├── translations/ar.json / en.json
    └── orbithub-light.png / orbithub-dark.png / orbithub-icon.png
```

كل منطق المصادقة وقاعدة البيانات يبقى بالكامل على السيرفر الرئيسي
(`hostaka.fun`). هذا السيرفر بس واجهة + بروكسي شفاف لـ `/api/*` تجاهه.

## كيف يشتغل البروكسي

أي طلب لـ `/api/*` على `orbithub.hostaka.fun` يوصل لـ `server.js`، اللي
يعيد إرساله (نفس الميثود، الهيدرز، الـ body) لـ `https://hostaka.fun/api/*`
عبر `node-fetch`، ويرجّع الرد كما هو للعميل. بما إن المتصفح يتعامل مع
هذا كطلب لنفس المصدر (orbithub.hostaka.fun)، **ما فيه مشكلة CORS
إطلاقاً ولا أي تعديل مطلوب على السيرفر الرئيسي**.

بخصوص الوسائط (صور/فيديو) بالمحادثات: تأكدت من كود المشروع الرئيسي —
الفيديو يرفع **مباشرة من المتصفح لـ Cloudinary** (يحصل بس على توقيع
JSON صغير من `/api/upload/video/signature`، مو الفيديو نفسه)، والصور
ترفع كـ base64 JSON صغير عبر `/api/upload`. يعني ما فيه خطر يصطدم
بحد حجم الطلب حق Vercel (4.5MB) من خلال هذا البروكسي.

## اختبار محلي

```bash
npm install
cp .env.example .env   # اختياري، القيمة الافتراضية تكفي
npm start
# افتح http://localhost:3000
```

## النشر على Vercel

1. مشروع Vercel جديد من هذا المستودع (منفصل عن مشروع hostaka.fun).
2. Vercel بيكتشف `vercel.json` تلقائياً (نفس نمط `@vercel/node` المستخدم
   بالمشروع الرئيسي بالضبط).
3. من Settings → Domains: أضف `orbithub.hostaka.fun`.
4. من DNS حق `hostaka.fun`: أضف سجل `CNAME` باسم `orbithub` يشاور على
   القيمة اللي يعطيك ياها Vercel بصفحة الـ Domain (عادة
   `cname.vercel-dns.com`).

## متغيرات البيئة على Vercel

| المتغير | مطلوب؟ | القيمة |
|---|---|---|
| `HOSTAKA_API_BASE` | ❌ اختياري | `https://hostaka.fun` (هذي القيمة الافتراضية بالكود أصلاً لو ما ضبطته) |

هذا كل شي. ما فيه قاعدة بيانات ولا JWT secret ولا مفاتيح API هنا —
كلها تبقى على المشروع الرئيسي فقط.

## آلية تمرير تسجيل الدخول بين النطاقين (مهم)

`localStorage` **ما ينشارك تلقائياً** بين `hostaka.fun` و
`orbithub.hostaka.fun` (نطاقين منفصلين تماماً بنظر المتصفح، حتى لو نفس
الدومين الأساسي).

**الحل الأساسي: oauth.hostaka.fun (وسيط تحقق مركزي)**

عند تحميل `chat.js`/`group.js`، لو ما فيه توكن محلي، الصفحة تسأل بصمت
`https://oauth.hostaka.fun/api/token` (`credentials:'include'`) — وسيط
مركزي يخزّن التوكن بكوكي مشترك (`Domain=.hostaka.fun`) فور كل تسجيل
دخول ناجح بالموقع الرئيسي. لو رجع توكن، يتخزّن محلياً هنا تلقائياً —
المستخدم يبان مسجّل دخول من غير ما يسوي أي شي، حتى لو جا من رابط عادي
بدون `?token=`. شوف مستودع `oauth` للتفاصيل الكاملة.

**الحل الاحتياطي (fallback): تمرير التوكن بالرابط**

لو oauth.hostaka.fun ما رجع شي (أول مرة يزور فيها أي نطاق تابع
لهوستاكا إطلاقاً، أو الكوكي المشترك محذوف)، تبقى الآلية القديمة تشتغل
كخط دفاع ثاني:

- **بالمستودع الرئيسي:** مسارات `/chat` و`/group` صارت تخدّم صفحة
  تحويل خفيفة تقرأ `hostaka_token` من `localStorage` المحلي، وتحوّل
  المستخدم لـ `https://orbithub.hostaka.fun/chat?token=...` (مع الحفاظ
  على أي query string كانت موجودة، مثل `?with=` أو `?g=`). **هذا يعني
  كل الروابط الداخلية القديمة بالكود (زر الرسائل، أزرار المجموعات،
  الإشعارات...) تشتغل تلقائياً بدون أي تعديل إضافي** — لأنها لسا توجه
  لنفس المسار على الموقع الرئيسي، وهو اللي يسوي التحويل.

- **بهذا المستودع:** أول ما تفتح `chat.js`/`group.js`، يدوّرون على
  `?token=` بالرابط. لو لقوه، يخزّنونه بـ localStorage المحلي حق
  orbithub، وبعدين يمسحونه فوراً من شريط العنوان (`history.replaceState`)
  عشان ما يضل ظاهر/قابل للمشاركة بالغلط.

- **حالة "ما فيه توكن إطلاقاً" (لا محلي ولا من oauth):** زر تسجيل
  الدخول يوديك لـ `hostaka.fun/login?next=<رابط الرجوع لهنا>`. تم
  إصلاح Bug بالموقع الرئيسي كان يتجاهل `?next=` تماماً — الآن يرجّعك
  صح بعد الدخول.

**⚠️ هذا التحديث (oauth + `/chat` و`/group` + إصلاح `?next=`) لازم يكون
منشور على مشروع hostaka.fun الرئيسي، وoauth.hostaka.fun لازم يكون
شغّال، قبل ما تفعّل orbithub بالكامل.**

## الروابط الخارجة تجاه الموقع الرئيسي

أي تنقّل لصفحات مو موجودة هنا (الرئيسية، البروفايل) يستخدم الثابت
`HOSTAKA_MAIN = 'https://hostaka.fun'` بأعلى `chat.js`/`group.js`.
شعار orbithub بالـ topbar (بدل كلمة "Hostaka" النصية القديمة) يرجّع
لـ `https://hostaka.fun/`.

## الشعار

- `orbithub-light.png` — الثيم الفاتح (كما هو).
- `orbithub-dark.png` — نسخة بيضاء بالكامل، تظهر تلقائياً بالثيم الداكن
  عبر قاعدة CSS بـ `shared.css`:
  ```css
  [data-theme="dark"] .brand-logo-light { display: none; }
  [data-theme="dark"] .brand-logo-dark  { display: inline-block; }
  ```
- `orbithub-icon.png` — الفافيكون.
