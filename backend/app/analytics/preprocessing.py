"""Shared data preparation for Finova's analytics endpoints.

All source dates are stored as Gregorian dates in SQLite. Analytics groups
transactions by Jalali month to match the application's budgeting calendar.
The functions here are intentionally independent of Prophet/ML libraries so
that data preparation can be tested without heavyweight optional packages.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
import math
from typing import Any

import jdatetime
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Budget, Category, Transaction


def jalali_today() -> jdatetime.date:
    return jdatetime.date.fromgregorian(date=date.today())


def shift_jalali_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def parse_month_key(value: str) -> tuple[int, int]:
    try:
        year, month = (int(part) for part in value.split("-", 1))
    except (ValueError, AttributeError) as exc:
        raise ValueError("ماه باید در قالب YYYY-MM شمسی باشد.") from exc
    if not 1300 <= year <= 1500 or not 1 <= month <= 12:
        raise ValueError("سال یا ماه شمسی خارج از محدوده مجاز است.")
    return year, month


def jalali_month_range(year: int, month: int) -> tuple[date, date]:
    start = jdatetime.date(year, month, 1).togregorian()
    next_year, next_month = shift_jalali_month(year, month, 1)
    next_start = jdatetime.date(next_year, next_month, 1).togregorian()
    return start, next_start - timedelta(days=1)


def completed_month_keys(months: int, *, today: jdatetime.date | None = None) -> list[str]:
    """Return the last N *completed* Jalali months, oldest first."""
    if months < 1 or months > 60:
        raise ValueError("تعداد ماه‌ها باید بین ۱ تا ۶۰ باشد.")
    current = today or jalali_today()
    last_year, last_month = shift_jalali_month(current.year, current.month, -1)
    return [
        month_key(*shift_jalali_month(last_year, last_month, offset))
        for offset in range(-(months - 1), 1)
    ]


def _make_empty_month(key: str) -> dict[str, Any]:
    year, month = parse_month_key(key)
    return {
        "period": key,
        "year": year,
        "month": month,
        "ds": jdatetime.date(year, month, 1).togregorian(),
        "income": 0,
        "expense": 0,
        "income_count": 0,
        "expense_count": 0,
        "expense_by_category": defaultdict(int),
        "income_by_category": defaultdict(int),
        "records": [],
    }


def build_monthly_financial_data(
    db: Session,
    user_id: int,
    months: int = 24,
) -> dict[str, Any]:
    """Load one user's completed-month financial ledger and budget totals."""
    keys = completed_month_keys(months)
    first_year, first_month = parse_month_key(keys[0])
    last_year, last_month = parse_month_key(keys[-1])
    start_date, _ = jalali_month_range(first_year, first_month)
    _, end_date = jalali_month_range(last_year, last_month)

    month_map = {key: _make_empty_month(key) for key in keys}
    category_lookup = {
        row.id: row.name
        for row in db.scalars(
            select(Category).where(
                or_(Category.user_id == user_id, Category.user_id.is_(None))
            )
        ).all()
    }

    rows = db.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        ).order_by(Transaction.transaction_date.asc(), Transaction.id.asc())
    ).scalars().all()

    all_records: list[dict[str, Any]] = []
    for tx in rows:
        jalali_date = jdatetime.date.fromgregorian(date=tx.transaction_date)
        key = month_key(jalali_date.year, jalali_date.month)
        if key not in month_map:
            continue
        category_name = category_lookup.get(tx.category_id, "سایر هزینه‌ها")
        record = {
            "id": tx.id,
            "date": tx.transaction_date.isoformat(),
            "period": key,
            "type": tx.type,
            "amount": int(tx.amount),
            "category_id": tx.category_id,
            "category": category_name,
        }
        all_records.append(record)
        target = month_map[key]
        target["records"].append(record)
        if tx.type == "income":
            target["income"] += int(tx.amount)
            target["income_count"] += 1
            target["income_by_category"][category_name] += int(tx.amount)
        elif tx.type == "expense":
            target["expense"] += int(tx.amount)
            target["expense_count"] += 1
            target["expense_by_category"][category_name] += int(tx.amount)

    period_filters = [
        (Budget.year == year) & (Budget.month == month)
        for year, month in (parse_month_key(key) for key in keys)
    ]
    budget_rows = db.scalars(
        select(Budget).where(Budget.user_id == user_id, or_(*period_filters))
    ).all()
    budget_totals: dict[str, int] = defaultdict(int)
    budget_by_category: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for budget in budget_rows:
        key = month_key(budget.year, budget.month)
        name = category_lookup.get(budget.category_id, "دسته‌بندی نامشخص")
        budget_totals[key] += int(budget.amount)
        budget_by_category[key][name] += int(budget.amount)

    result_months: list[dict[str, Any]] = []
    for key in keys:
        item = month_map[key]
        budget_total = budget_totals.get(key, 0)
        item["budget_total"] = budget_total
        item["budget_by_category"] = dict(budget_by_category.get(key, {}))
        item["budget_usage"] = item["expense"] / budget_total if budget_total > 0 else 0.0
        item["expense_by_category"] = dict(item["expense_by_category"])
        item["income_by_category"] = dict(item["income_by_category"])
        result_months.append(item)

    return {
        "keys": keys,
        "months": result_months,
        "records": all_records,
        "categories": category_lookup,
        "start_date": start_date,
        "end_date": end_date,
    }


def month_expense_values(data: dict[str, Any], category_id: int | None = None) -> list[int]:
    if category_id is None:
        return [int(item["expense"]) for item in data["months"]]
    # Resolve category_id to its name using this user's accessible categories.
    category_name = data["categories"].get(category_id)
    if category_name is None:
        return [0 for _ in data["months"]]
    return [int(item["expense_by_category"].get(category_name, 0)) for item in data["months"]]


def build_baskets(records: list[dict[str, Any]], bucket: str = "day") -> list[set[str]]:
    """Convert expenses into baskets grouped by day or ISO week."""
    if bucket not in {"day", "week"}:
        raise ValueError("bucket باید day یا week باشد.")
    grouped: dict[str, set[str]] = defaultdict(set)
    for row in records:
        if row.get("type") != "expense" or not row.get("category"):
            continue
        tx_date = date.fromisoformat(row["date"])
        if bucket == "day":
            key = tx_date.isoformat()
        else:
            monday = tx_date - timedelta(days=tx_date.weekday())
            key = monday.isoformat()
        grouped[key].add(str(row["category"]))
    return [items for _, items in sorted(grouped.items()) if items]


def build_cluster_features(months: list[dict[str, Any]], top_categories: int = 5) -> tuple[list[str], list[list[float]], list[dict[str, Any]]]:
    """Create monthly numeric features for one user's financial behavior."""
    totals: dict[str, int] = defaultdict(int)
    for item in months:
        for name, amount in item["expense_by_category"].items():
            totals[name] += int(amount)
    selected = [name for name, _ in sorted(totals.items(), key=lambda pair: pair[1], reverse=True)[:top_categories]]
    feature_names = [
        "log_monthly_expense",
        "expense_to_income",
        "savings_rate",
        "budget_usage",
        *[f"share:{name}" for name in selected],
        "share:other",
    ]

    matrix: list[list[float]] = []
    active_months: list[dict[str, Any]] = []
    for item in months:
        # Ignore months with no financial records: they are not observed behavior.
        if item["income_count"] + item["expense_count"] == 0:
            continue
        income = float(item["income"])
        expense = float(item["expense"])
        ratio = expense / income if income > 0 else 0.0
        savings = (income - expense) / income if income > 0 else 0.0
        category_total = sum(item["expense_by_category"].values())
        shares = [
            (item["expense_by_category"].get(name, 0) / category_total)
            if category_total > 0 else 0.0
            for name in selected
        ]
        other = max(0.0, 1.0 - sum(shares)) if category_total > 0 else 0.0
        vector = [
            float(math.log1p(expense)),
            ratio,
            savings,
            float(item["budget_usage"]),
            *shares,
            other,
        ]
        matrix.append(vector)
        active_months.append({
            "period": item["period"],
            "income": int(income),
            "expense": int(expense),
            "budget_usage": round(float(item["budget_usage"]), 4),
        })
    return feature_names, matrix, active_months
