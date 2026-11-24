# Finova — راهنمای پیاده‌سازی و آزمون امنیت

این سند مسیرهای کد و روش بررسی کنترل‌های امنیتی را مشخص می‌کند. امنیت یک وضعیت ثابت نیست؛ پس از هر تغییر در احراز هویت، API، قالب‌های HTML یا تنظیمات استقرار، تست‌ها باید دوباره اجرا شوند.

## نقشه کنترل‌ها و فایل‌ها

| کنترل | پیاده‌سازی در فایل‌ها | روش تست |
|---|---|---|
| کلید امضای JWT و تنظیمات محرمانه | `backend/app/security.py`, `.env.example`, `.gitignore` | متغیر `FINOVA_SECRET_KEY` را بررسی کنید؛ در Production بدون کلید قوی برنامه باید متوقف شود. `test_rotating_signing_secret_invalidates_previous_jwts` چرخش کلید را می‌آزماید. |
| هش رمز عبور Argon2id | `backend/app/security.py`, `backend/app/routers/auth.py`, `backend/app/routers/profile.py` | `test_password_is_argon2_hash_not_plaintext`؛ ثبت‌نام کنید و بررسی کنید مقدار `password_hash` با `$argon2id$` شروع شود و برابر رمز خام نباشد. |
| Cookie نشست HttpOnly | `backend/app/security.py`, `backend/app/routers/auth.py` | `test_cookie_auth_csrf_logout_and_security_events`؛ پس از Login، Cookie `finova_session` باید HttpOnly و SameSite=Lax باشد. |
| CSRF و Origin | `backend/app/main.py`, `Frontend/src/api/client.js` | همان تست Cookie/CSRF؛ درخواست تغییردهنده بدون `X-CSRF-Token` باید 403 شود؛ Origin غیرمجاز نیز باید 403 بگیرد. |
| Rate Limiting | `backend/app/routers/auth.py`, مدل‌های `LoginAttempt` در `backend/app/models.py` | `test_login_rate_limit_and_failed_login_audit` (محدودیت ایمیل) و `test_rate_limit_also_applies_per_ip` (محدودیت IP)؛ پاسخ مسدودشده باید 429 و `Retry-After: 900` باشد. |
| ثبت رخدادهای امنیتی | `backend/app/security_events.py`, `backend/app/models.py`, `backend/app/routers/auth.py`, `backend/app/routers/profile.py` | `test_cookie_auth_csrf_logout_and_security_events`, `test_login_rate_limit_and_failed_login_audit`, `test_security_events_store_hashed_identifiers`؛ ایمیل/IP خام نباید در ستون‌های Hash ذخیره شوند. |
| ابطال نشست | `backend/app/dependencies.py`, `backend/app/routers/auth.py`, `backend/app/routers/profile.py`, `backend/app/models.py` | `test_cookie_auth_csrf_logout_and_security_events` و `test_password_change_revokes_existing_sessions`؛ پس از Logout یا تغییر رمز، نشست قبلی باید 401 بگیرد. |
| چرخش کلید | `backend/app/security.py` | `test_rotating_signing_secret_invalidates_previous_jwts`؛ JWT با کلید جدید نباید با کلید قبلی معتبر بماند. |
| کاهش ریسک XSS و CSP | `Frontend/src/**` (React)، `Frontend/index.html` | `test_react_frontend_escapes_output_and_sets_csp`؛ React به‌صورت پیش‌فرض خروجی را Escape می‌کند و تست نبود `dangerouslySetInnerHTML`/`innerHTML` و وجود CSP را بررسی می‌کند. ورودی آزمایشی HTML را هم در محیط محلی وارد کنید و ببینید به‌عنوان متن نمایش داده می‌شود. |
| HTTP Security Headers | `backend/app/main.py` | `test_security_headers_are_returned`؛ Headerهای `nosniff`، `DENY`، Referrer-Policy و Permissions-Policy بررسی می‌شوند. |
| الگوهای رایج کلیدهای API | `backend/tests/test_security.py` | `test_no_common_provider_api_key_patterns_are_committed`؛ اسکن ساده الگوهای رایج را اجرا می‌کند؛ جایگزین Secret Scanner حرفه‌ای نیست. |

## تنظیم اسرار

1. فایل `.env.example` را در ریشه پروژه به `.env` کپی کنید.
2. کلید تصادفی بسازید:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

3. خروجی را در `FINOVA_SECRET_KEY` قرار دهید.
4. برای استقرار واقعی `FINOVA_ENV=production` و HTTPS را فعال کنید.
5. `FINOVA_ALLOWED_ORIGINS` را به Originهای واقعی Frontend محدود کنید.
6. `.env` و دیتابیس را در Git Commit نکنید.

نام قدیمی `DARIK_SECRET_KEY` برای سازگاری با تنظیمات قبلی به‌عنوان fallback پشتیبانی می‌شود؛ توصیه می‌شود تنظیمات استقرار به `FINOVA_SECRET_KEY` منتقل شود.

## اجرای تست‌ها

از پوشه `backend`:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest -v tests/test_security.py
python -m compileall -q app tests
```

در صورت نصب Node.js، ساخت فرانت‌اند React:

```powershell
cd ..\Frontend
npm.cmd install
npm.cmd run build
```

## نتیجه آزمون در محیط تهیه این بسته

- تست‌های `backend/tests/test_security.py`: **۸ تست موفق**.
- `python -m compileall -q backend/app backend/tests`: موفق.
- `npm.cmd run build` برای فرانت‌اند React: موفق.

**محدودیت بازتولیدپذیری:** محیط اجرای بسته امکان دریافت وابستگی از اینترنت نداشت و `pwdlib` و `jdatetime` در آن نصب نبودند. برای اجرای تست‌ها در همین محیط، یک Adapter موقت برای رابط `pwdlib` با استفاده از `argon2-cffi` و یک Stub واردسازی برای `jdatetime` استفاده شد؛ هیچ‌کدام از این دو فایل موقت وارد مخزن پروژه نشده‌اند. بنابراین نتیجه ۱۱ تست، آزمون منطق برنامه در Harness ایزوله است و جای اجرای دوباره تست‌ها با وابستگی‌های واقعی در محیط توسعه شما را نمی‌گیرد. پس از نصب `requirements-dev.txt` در محیط خودتان، فرمان‌های بالا را اجرا و خروجی را ذخیره کنید.

## نکات مهم و محدودیت‌های امنیتی

- فرانت‌اند React است و از `dangerouslySetInnerHTML` یا `innerHTML` استفاده نمی‌کند؛ React مقادیر متغیر را به‌صورت خودکار Escape می‌کند. با این حال هر کامپوننت جدید باید همین الگو را حفظ کند و CSP لایه دفاعی دوم است، نه جایگزین بازبینی کد.
- CSP در Meta Tag صفحه قرار دارد و برای سازگاری رابط فعلی `style-src 'unsafe-inline'` (به‌دلیل Style Attributeهای درون‌خطی) را مجاز می‌کند؛ Chart.js و Lucide به‌صورت بسته‌بندی‌شده و self-host هستند. برای Production بهتر است CSP از Header وب‌سرور ارائه شود، `frame-ancestors` در Header تنظیم شود و منبع مجاز اتصال به API به دامنه واقعی محدود گردد.
- Rate Limiting مبتنی بر SQLite برای اجرای تک‌نمونه‌ای است. برای چند Worker/سرور، Redis لازم است. اگر پشت Reverse Proxy هستید، IP فقط از Proxy مورداعتماد خوانده شود؛ در حال حاضر `X-Forwarded-For` عمداً اعتماد نمی‌شود.
- تغییر `FINOVA_SECRET_KEY` تمام JWTهای قبلی را نامعتبر می‌کند. این کار کلیدهای API خارجی را باطل نمی‌کند. کلید Provider باید از پنل همان Provider Rotate/Revoke شود.
- جدول رخدادهای امنیتی و جدول توکن‌های باطل‌شده در این نسخه سیاست Retention خودکار کامل ندارند؛ برای Production باید برنامه پاک‌سازی، مانیتورینگ و هشدار تعریف شود.
- فرانت‌اند React برای احراز هویت، تراکنش‌ها، دسته‌بندی‌ها، بودجه‌ها و پروفایل به API متصل است و داده نمایشی محلی ندارد؛ با این حال امنیت Backend به‌تنهایی به معنی امن بودن کامل رابط کاربری نیست و تست نفوذ حرفه‌ای همچنان توصیه می‌شود.
- این بسته گزارش ارزیابی کد و تست‌های خودکار است، نه گواهی امنیت، ممیزی مستقل یا تست نفوذ جامع.


## امنیت Endpointهای تحلیل هوشمند

- تمام Endpointهای `/api/analytics/*` از Dependency احراز هویت `CurrentUser` استفاده می‌کنند.
- شناسه کاربر از Cookie نشست معتبر استخراج می‌شود و از Query یا Body درخواست دریافت نمی‌شود.
- پرس‌وجوهای تراکنش و بودجه در لایه پیش‌پردازش با `user_id` همان نشست محدود شده‌اند.
- Apriori و K-Means فقط داده‌های حساب جاری را پردازش می‌کنند و داده کاربران مختلف با یکدیگر ادغام نمی‌شوند.
- Endpointهای تحلیل فقط GET و خواندنی هستند؛ از همان کنترل احراز هویت و Middlewareهای عمومی برنامه استفاده می‌کنند.
- خروجی Analytics باید بدون ایمیل، IP، عنوان تراکنش یا توضیحات شخصی به رابط کاربری ارسال شود؛ این پیاده‌سازی فقط مقادیر تجمیعی و نام دسته‌بندی را برمی‌گرداند.

پس از هر تغییر در لایه Analytics، تست‌های `backend/tests/test_analytics_api.py` و `backend/tests/test_analytics_services.py` را اجرا کنید.
