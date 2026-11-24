
from datetime import date, timedelta

import jdatetime
from fastapi import APIRouter, Query
from sqlalchemy import select, func

from app.dependencies import CurrentUser, DbSession
from app.models import Transaction, Category


router = APIRouter(
    prefix="/api/reports",
    tags=["Reports"],
)


def jalali_month_range(year: int, month: int) -> tuple[date, date]:
    start = jdatetime.date(year, month, 1).togregorian()

    if month == 12:
        next_month = jdatetime.date(year + 1, 1, 1)
    else:
        next_month = jdatetime.date(year, month + 1, 1)

    end = next_month.togregorian() - timedelta(days=1)

    return start, end


@router.get("/monthly")
def monthly_report(
    user: CurrentUser,
    db: DbSession,
    year: int = Query(ge=1300, le=1500),
    month: int = Query(ge=1, le=12),
    months: int = Query(default=6, ge=1, le=24),
):
    # ساخت فهرست ماه‌ها، از قدیمی به جدید
    selected_months = []

    current_year = year
    current_month = month

    for _ in range(months):
        selected_months.append((current_year, current_month))

        current_month -= 1
        if current_month == 0:
            current_month = 12
            current_year -= 1

    selected_months.reverse()

    monthly_data = []

    for item_year, item_month in selected_months:
        start_date, end_date = jalali_month_range(
            item_year, item_month
        )

        income_query = select(
            func.coalesce(func.sum(Transaction.amount), 0)
        ).where(
            Transaction.user_id == user.id,
            Transaction.type == "income",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )

        expense_query = select(
            func.coalesce(func.sum(Transaction.amount), 0)
        ).where(
            Transaction.user_id == user.id,
            Transaction.type == "expense",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )

        income = int(db.scalar(income_query) or 0)
        expense = int(db.scalar(expense_query) or 0)

        monthly_data.append({
            "year": item_year,
            "month": item_month,
            "income": income,
            "expense": expense,
            "balance": income - expense,
        })

    total_income = sum(item["income"] for item in monthly_data)
    total_expense = sum(item["expense"] for item in monthly_data)

    # هزینه‌ها بر اساس دسته‌بندی در کل بازه
    first_year, first_month = selected_months[0]
    last_year, last_month = selected_months[-1]

    start_date, _ = jalali_month_range(first_year, first_month)
    _, end_date = jalali_month_range(last_year, last_month)

    category_query = (
        select(
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .where(
            Transaction.user_id == user.id,
            Transaction.type == "expense",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )
        .group_by(Category.id, Category.name)
        .order_by(func.sum(Transaction.amount).desc())
    )

    categories = [
        {
            "category_id": row.category_id,
            "category_name": row.category_name,
            "amount": int(row.amount or 0),
        }
        for row in db.execute(category_query).all()
    ]

    return {
        "period": {
            "from": {
                "year": first_year,
                "month": first_month,
            },
            "to": {
                "year": last_year,
                "month": last_month,
            },
            "months_count": months,
        },
        "totals": {
            "income": total_income,
            "expense": total_expense,
            "balance": total_income - total_expense,
        },
        "monthly_data": monthly_data,
        "expense_by_category": categories,
    }
