from __future__ import annotations

import argparse
import re
import shutil
from datetime import datetime
from pathlib import Path


def replace_once(path: Path, old: str, new: str, *, label: str) -> None:
    content = path.read_text(encoding="utf-8")
    if new in content:
        print(f"[already applied] {label}")
        return
    count = content.count(old)
    if count != 1:
        raise RuntimeError(
            f"Cannot safely patch {path}: expected one match for {label}, found {count}. "
            "No further changes were made to this file."
        )
    path.write_text(content.replace(old, new, 1), encoding="utf-8")
    print(f"[patched] {label}")


def replace_regex_once(path: Path, pattern: str, replacement: str, *, label: str) -> None:
    content = path.read_text(encoding="utf-8")
    if replacement in content:
        print(f"[already applied] {label}")
        return
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(
            f"Cannot safely patch {path}: expected one match for {label}, found {count}. "
            "No further changes were made to this file."
        )
    path.write_text(updated, encoding="utf-8")
    print(f"[patched] {label}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply the Finova Prophet + Apriori + K-Means analytics upgrade."
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path.cwd(),
        help="Path to the existing Finova_R repository root (default: current directory).",
    )
    args = parser.parse_args()

    project_root = args.project_root.resolve()
    patch_source = Path(__file__).resolve().parent / "PATCH_FILES"
    required = [
        "backend/app/main.py",
        "Frontend/src/App.jsx",
        "Frontend/src/components/Layout.jsx",
        "Frontend/src/pages/Forecast.jsx",
        "Frontend/src/pages/Dashboard.jsx",
        "Frontend/src/main.jsx",
    ]
    missing = [item for item in required if not (project_root / item).is_file()]
    if missing:
        raise SystemExit(
            "این مسیر، ریشه مخزن Finova_R نیست یا فایل‌های اصلی پیدا نشدند:\n- "
            + "\n- ".join(missing)
        )
    if not patch_source.is_dir():
        raise SystemExit("پوشه PATCH_FILES کنار اسکریپت پیدا نشد؛ ZIP را کامل استخراج کنید.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_root = project_root / ".finova_analytics_backups" / stamp
    files_to_backup = [
        "backend/app/main.py",
        "Frontend/src/App.jsx",
        "Frontend/src/components/Layout.jsx",
        "Frontend/src/pages/Forecast.jsx",
        "Frontend/src/pages/Dashboard.jsx",
        "Frontend/src/main.jsx",
        "backend/requirements.txt",
        "backend/requirements-dev.txt",
        "backend/requirements-lock.txt",
        "backend/requirments.txt",
        "backend/app/requirments.txt",
        "README.md",
        "SECURITY.md",
    ]
    for relative in files_to_backup:
        source = project_root / relative
        if source.exists():
            target = backup_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    print(f"Backups saved in: {backup_root}")

    # Copy all new files and replacement dependency manifests into the repository.
    shutil.copytree(patch_source, project_root, dirs_exist_ok=True)

    # Backend router registration.
    main_py = project_root / "backend/app/main.py"
    replace_once(
        main_py,
        "from app.routers.profile import router as profile_router\n",
        "from app.routers.profile import router as profile_router\n"
        "from app.routers.analytics import router as analytics_router\n",
        label="register analytics router import",
    )
    replace_once(
        main_py,
        "app.include_router(profile_router)\n",
        "app.include_router(profile_router)\napp.include_router(analytics_router)\n",
        label="register analytics router",
    )

    # Frontend routing.
    app_jsx = project_root / "Frontend/src/App.jsx"
    replace_once(
        app_jsx,
        "import Profile from './pages/Profile.jsx';\n",
        "import Profile from './pages/Profile.jsx';\nimport Insights from './pages/Insights.jsx';\n",
        label="import Insights page",
    )
    replace_once(
        app_jsx,
        '          <Route path="reports" element={<Reports />} />\n',
        '          <Route path="reports" element={<Reports />} />\n'
        '          <Route path="insights" element={<Insights />} />\n',
        label="add Insights route",
    )

    layout = project_root / "Frontend/src/components/Layout.jsx"
    replace_once(
        layout,
        "  { to: '/reports', icon: 'file-bar-chart', label: 'گزارش‌ها' },\n",
        "  { to: '/reports', icon: 'file-bar-chart', label: 'گزارش‌ها' },\n"
        "  { to: '/insights', icon: 'network', label: 'تحلیل هوشمند' },\n",
        label="add Insights navigation item",
    )
    replace_once(
        layout,
        "  '/reports': 'گزارش‌ها و تحلیل مالی | Finova',\n",
        "  '/reports': 'گزارش‌ها و تحلیل مالی | Finova',\n"
        "  '/insights': 'تحلیل هوشمند مخارج | Finova',\n",
        label="add Insights page title",
    )

    # Prophet replaces the primary prediction presentation; the existing WMA UI remains
    # visible below as a transparent baseline for side-by-side comparison.
    forecast = project_root / "Frontend/src/pages/Forecast.jsx"
    replace_once(
        forecast,
        "import ChartCanvas from '../components/ChartCanvas.jsx';\n",
        "import ChartCanvas from '../components/ChartCanvas.jsx';\n"
        "import ProphetForecastPanel from '../components/ProphetForecastPanel.jsx';\n",
        label="import Prophet forecast panel",
    )
    replace_once(
        forecast,
        "  const activeCategory = category !== 'all' && !categoryOptions.includes(category) ? 'all' : category;\n",
        "  const activeCategory = category !== 'all' && !categoryOptions.includes(category) ? 'all' : category;\n"
        "  const selectedCategoryId = activeCategory === 'all'\n"
        "    ? null\n"
        "    : categoriesFor('expense').find((item) => item.name === activeCategory)?.id ?? null;\n",
        label="resolve selected expense category ID",
    )
    replace_once(
        forecast,
        '      <section className="card fc-basis" aria-labelledby="fcBasisTitle">\n',
        '      <ProphetForecastPanel horizon={horizon} categoryId={selectedCategoryId} />\n\n'
        '      <section className="card fc-basis" aria-labelledby="fcBasisTitle">\n',
        label="mount Prophet panel on forecast page",
    )
    replace_once(
        forecast,
        "روش: میانگین متحرک وزنی",
        "روش پایه مقایسه: میانگین متحرک وزنی",
        label="clarify legacy WMA baseline",
    )
    replace_once(
        forecast,
        "هزینه واقعی و پیش‌بینی‌شده</h2>",
        "هزینه واقعی و برآورد پایه WMA</h2>",
        label="clarify WMA chart title",
    )
    replace_once(
        forecast,
        "هزینه پیش‌بینی‌شده برای ماه آینده",
        "برآورد پایه WMA برای ماه آینده",
        label="clarify legacy WMA KPI label",
    )
    replace_once(
        forecast,
        "forecast: 'پیش‌بینی (برآورد)'",
        "forecast: 'برآورد پایه WMA'",
        label="clarify WMA month table label",
    )

    # Dashboard gets a live Prophet KPI badge while retaining its historical WMA chart.
    dashboard = project_root / "Frontend/src/pages/Dashboard.jsx"
    replace_once(
        dashboard,
        "import ChartCanvas from '../components/ChartCanvas.jsx';\n",
        "import ChartCanvas from '../components/ChartCanvas.jsx';\n"
        "import ProphetDashboardBadge from '../components/ProphetDashboardBadge.jsx';\n",
        label="import Prophet dashboard KPI",
    )
    replace_regex_once(
        dashboard,
        r'<Link className="forecast-chip" to="/expense-forecast">.*?</Link>',
        "<ProphetDashboardBadge />",
        label="replace dashboard WMA chip with Prophet KPI",
    )
    replace_once(
        dashboard,
        "همراه با پیش‌بینی پایه {nextLabel} به روش میانگین متحرک وزنی (میلیون تومان)",
        "روند تاریخی و خط پایه WMA؛ مقدار Prophet در کارت پیش‌بینی نمایش داده می‌شود (میلیون تومان)",
        label="explain dashboard WMA baseline",
    )

    # Load the new page stylesheet.
    main_jsx = project_root / "Frontend/src/main.jsx"
    replace_once(
        main_jsx,
        "import './styles/auth.css';\n",
        "import './styles/auth.css';\nimport './styles/insights.css';\n",
        label="load analytics styles",
    )

    # Clean the historical misspelling now that the correct requirements file exists.
    for relative in ("backend/requirments.txt", "backend/app/requirments.txt"):
        old_file = project_root / relative
        if old_file.exists():
            old_file.unlink()
            print(f"[removed obsolete file] {relative}")

    readme = project_root / "README.md"
    analytics_section = """

## تحلیل هوشمند (Analytics)

نسخه توسعه‌یافته Finova سه قابلیت تحلیلی در Backend دارد:

- **Prophet:** پیش‌بینی هزینه ماهانه با بازه عدم‌قطعیت؛ WMA به‌عنوان خط پایه و fallback حفظ شده است.
- **Apriori:** استخراج قوانین انجمنی از سبدهای هزینه روزانه یا هفتگی با Support، Confidence و Lift.
- **K-Means:** خوشه‌بندی ماه‌های مالی یک کاربر با StandardScaler و انتخاب K بر اساس Silhouette.

APIها:

- `GET /api/analytics/forecast?horizon=3&months=36`
- `GET /api/analytics/patterns?months=12&bucket=day`
- `GET /api/analytics/clusters?months=24&max_clusters=4`

هر API به نشست کاربر فعلی وابسته است و فقط تراکنش‌ها و بودجه‌های همان کاربر را پردازش می‌کند. صفحه تحلیل هوشمند در مسیر `/insights` قرار دارد.

برای نصب وابستگی‌ها از پوشه `backend` اجرا کنید:

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt
python -m pytest -q tests
```

برای به‌روزرسانی فایل قفل پس از نصب موفق روی محیط هدف:

```powershell
python -m pip freeze > requirements-lock.txt
```

**محدودیت داده:** Prophet برای سابقه کمتر از ۲۴ ماه به WMA برمی‌گردد؛ فصل‌مندی سالانه فقط از ۳۶ ماه کامل فعال می‌شود. برای Apriori، هر روز یا هفته یک Basket است. خوشه‌بندی نیز فقط از ماه‌های دارای تراکنش همان حساب استفاده می‌کند؛ داده کم یا بدون تنوع، پیام کمبود داده تولید می‌کند.
"""
    readme_content = readme.read_text(encoding="utf-8")
    marker = "## مشارکت و توسعه"
    if "## تحلیل هوشمند (Analytics)" not in readme_content:
        if marker in readme_content:
            readme.write_text(readme_content.replace(marker, analytics_section + "\n" + marker, 1), encoding="utf-8")
        else:
            readme.write_text(readme_content + analytics_section, encoding="utf-8")
        print("[patched] analytics README documentation")
    else:
        print("[already applied] analytics README documentation")

    security_md = project_root / "SECURITY.md"
    security_section = """

## امنیت Endpointهای تحلیل هوشمند

- تمام Endpointهای `/api/analytics/*` از Dependency احراز هویت `CurrentUser` استفاده می‌کنند.
- شناسه کاربر از Cookie نشست معتبر استخراج می‌شود و از Query یا Body درخواست دریافت نمی‌شود.
- پرس‌وجوهای تراکنش و بودجه در لایه پیش‌پردازش با `user_id` همان نشست محدود شده‌اند.
- Apriori و K-Means فقط داده‌های حساب جاری را پردازش می‌کنند و داده کاربران مختلف با یکدیگر ادغام نمی‌شوند.
- Endpointهای تحلیل فقط GET و خواندنی هستند؛ از همان کنترل احراز هویت و Middlewareهای عمومی برنامه استفاده می‌کنند.
- خروجی Analytics باید بدون ایمیل، IP، عنوان تراکنش یا توضیحات شخصی به رابط کاربری ارسال شود؛ این پیاده‌سازی فقط مقادیر تجمیعی و نام دسته‌بندی را برمی‌گرداند.

پس از هر تغییر در لایه Analytics، تست‌های `backend/tests/test_analytics_api.py` و `backend/tests/test_analytics_services.py` را اجرا کنید.
"""
    security_content = security_md.read_text(encoding="utf-8") if security_md.exists() else "# Finova Security\n"
    if "## امنیت Endpointهای تحلیل هوشمند" not in security_content:
        security_md.write_text(security_content + security_section, encoding="utf-8")
        print("[patched] analytics security documentation")
    else:
        print("[already applied] analytics security documentation")

    print("\nFinova analytics upgrade applied.")
    print("Next: install backend requirements, run tests, then start FastAPI and Vite.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
