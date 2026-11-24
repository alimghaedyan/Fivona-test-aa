# نصب افزونه تحلیل هوشمند Finova

این ZIP یک **بسته ارتقای مخزن موجود** است؛ فایل‌های اصلی Finova را جایگزین نمی‌کند. اسکریپت، فایل‌های جدید را اضافه و نقاط اتصال را در فایل‌های فعلی اصلاح می‌کند. قبل از تغییر، از فایل‌های اصلی نسخه پشتیبان می‌گیرد.

## ۱) استخراج و اعمال تغییرات

ابتدا ZIP را در یک مسیر دلخواه Extract کنید. سپس PowerShell را باز کنید و دستور زیر را با مسیر واقعی مخزن خودتان اجرا کنید:

```powershell
python .\Finova_Analytics_Upgrade_v1\apply_analytics_upgrade.py --project-root "E:\مسیر\Fivona_R"
```

اگر پوشه افزونه را داخل ریشه مخزن استخراج کرده‌اید:

```powershell
python .\Finova_Analytics_Upgrade_v1\apply_analytics_upgrade.py --project-root .
```

اسکریپت پیش از تغییر فایل‌های اصلی از آن‌ها در پوشه `.finova_analytics_backups` نسخه پشتیبان می‌گیرد.

## ۲) نصب وابستگی‌ها

```powershell
cd "E:\مسیر\Fivona_R\backend"
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt
```

اگر محیط مجازی هنوز ساخته نشده است:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

نصب اولیه Prophet، SciPy، Scikit-learn، Pandas و NumPy به اینترنت نیاز دارد. پس از نصب می‌توان الگوریتم‌ها را به‌صورت محلی اجرا کرد.

## ۳) اجرای تست‌ها

از پوشه `backend`:

```powershell
python -m pytest -v tests
python -m compileall -q app tests
```

## ۴) اجرای برنامه

ترمینال اول:

```powershell
cd "E:\مسیر\Fivona_R\backend"
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload
```

ترمینال دوم:

```powershell
cd "E:\مسیر\Fivona_R\Frontend"
npm.cmd install
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

صفحه تحلیل هوشمند در مسیر زیر اضافه می‌شود:

```text
http://127.0.0.1:5173/#/insights
```

## ۵) نکته مهم برای تست واقعی

- برای اینکه Prophet با فصل‌مندی سالانه اجرا شود، باید حداقل ۳۶ ماه کامل دارای ثبت هزینه وجود داشته باشد.
- با سابقه کمتر از ۲۴ ماه، WMA به‌عنوان fallback نمایش داده می‌شود.
- Apriori برای استخراج الگو به چندین روز/هفته دارای هزینه در چند دسته نیاز دارد.
- K-Means حداقل ۱۲ ماه فعال می‌خواهد.
- اگر حساب فعلی داده کافی ندارد، ابتدا باید با داده آزمایشی مشخص و غیرشخصی، رفتار الگوریتم را آزمایش کنیم. نتایج ساختگی نباید به‌عنوان نتیجه حساب واقعی نمایش داده شوند.
