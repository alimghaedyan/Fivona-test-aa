# Finova Analytics Upgrade

این بسته سه قابلیت تحلیلی را به مخزن موجود Finova اضافه می‌کند: Prophet، Apriori و K-Means.

## اجزای اضافه‌شده

### Backend

- `app/analytics/preprocessing.py`: بارگذاری داده فقط برای کاربر جاری، تبدیل تاریخ میلادی به ماه شمسی، ساخت داده ماهانه، Basket و ماتریس ویژگی.
- `app/analytics/forecasting.py`: پیش‌بینی Prophet، خط پایه WMA، بازه عدم‌قطعیت و ارزیابی expanding-window.
- `app/analytics/association.py`: استخراج مجموعه‌های پرتکرار و قوانین انجمنی Apriori.
- `app/analytics/clustering.py`: ساخت ویژگی‌های ماهانه، StandardScaler، K-Means و Silhouette.
- `app/analytics/schemas.py`: قراردادهای خروجی API.
- `app/routers/analytics.py`: سه Endpoint احراز هویت‌شده.

### Frontend

- `src/api/analytics.js`: کلاینت REST برای APIهای تحلیل.
- `src/components/ProphetForecastPanel.jsx`: بخش Prophet و مقایسه آن با WMA در صفحه پیش‌بینی.
- `src/components/ProphetDashboardBadge.jsx`: نمایش مقدار پیش‌بینی Prophet در داشبورد.
- `src/pages/Insights.jsx`: صفحه Apriori و K-Means در مسیر `#/insights`.
- `src/styles/insights.css`: استایل‌های جدید.

## APIها

- `GET /api/analytics/forecast?horizon=1|3|6&months=36&category_id=...&include_evaluation=false`
- `GET /api/analytics/patterns?months=12&bucket=day|week&min_support=0.10&min_confidence=0.50&min_lift=1.0&min_occurrences=3`
- `GET /api/analytics/clusters?months=24&max_clusters=4&min_active_months=12`

همه Endpointها از `CurrentUser` استفاده می‌کنند. `user_id` از داده نشست گرفته می‌شود؛ هیچ API شناسه کاربر را از Query دریافت نمی‌کند.

## سیاست داده و محدودیت‌ها

- تاریخ‌ها در دیتابیس میلادی‌اند؛ گروه‌بندی مالی با تقویم شمسی انجام می‌شود.
- فقط ماه‌های کامل وارد تحلیل می‌شوند؛ ماه جاری کنار گذاشته می‌شود.
- نبود تراکنش در یک ماه کامل به‌عنوان صفرِ ثبت‌شده لحاظ می‌شود. این به معنی اثبات نبود هزینه واقعی نیست؛ صحت تحلیل به کامل‌بودن ثبت داده توسط کاربر وابسته است.
- Prophet با کمتر از ۲۴ ماه تاریخچه از WMA استفاده می‌کند؛ فصل‌مندی سالانه فقط با حداقل ۳۶ ماه فعال می‌شود.
- Prophet بازه پیش‌بینی ۸۰ درصدی می‌دهد؛ این بازه تضمین نیست.
- ارزیابی Walk-forward expanding-window است و فقط در صورت درخواست محاسبه می‌شود؛ اجرای آن می‌تواند زمان Endpoint را افزایش دهد.
- Apriori در حالت روزانه هر روز، و در حالت هفتگی هر هفته را Basket در نظر می‌گیرد. این قواعد هم‌وقوعی هستند، نه علیت.
- K-Means فقط ماه‌های دارای تراکنش همان حساب را خوشه‌بندی می‌کند. برای جلوگیری از خوشه‌های ساختگی، حداقل ۱۲ ماه فعال در API پیش‌فرض لازم است.
- داده‌های خوشه‌بندی و Apriori میان کاربران ترکیب نمی‌شوند.

## نصب و تست

از پوشه `backend`:

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt
python -m pytest -q tests
```

Prophet، Pandas، NumPy، SciPy و Scikit-learn بسته‌های علمی نسبتاً حجیمی‌اند. نصب اولیه به اینترنت نیاز دارد؛ پس از نصب می‌توان برنامه را در شبکه محلی اجرا کرد.

برای ثبت دقیق نسخه‌های نصب‌شده در محیط نهایی:

```powershell
python -m pip freeze > requirements-lock.txt
```
