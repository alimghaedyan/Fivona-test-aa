
from datetime import date, timedelta

import jdatetime
from fastapi import APIRouter, Query
from sqlalchemy import select, func, case

from app.dependencies import CurrentUser, DbSession
from app.models import Transaction, Budget, Category


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
)


def jalali_month_range(year: int, month: int) -> tuple[date, date]:
    """تبدیل ماه شمسی به بازه تاریخ میلادی، شامل ابتدا و انتها."""
    start_jalali = jdatetime.date(year, month, 1)
    start_gregorian = start_jalali.togregorian()

    if month == 12:
        next_jalali = jdatetime.date(year + 1, 1, 1)
    else:
        next_jalali = jdatetime.date(year, month + 1, 1)

    next_gregorian = next_jalali.togregorian()

    return start_gregorian, next_gregorian - timedelta(days=1)


@router.get("/summary")
def dashboard_summary(
    user: CurrentUser,
    db: DbSession,
    year: int = Query(ge=1300, le=1500),
    month: int = Query(ge=1, le=12),
):
    start_date, end_date = jalali_month_range(year, month)

    totals_statement = select(
        func.coalesce(
            func.sum(
                case(
                    (Transaction.type == "income", Transaction.amount),
                    else_=0,
                )
            ),
            0,
        ).label("total_income"),
        func.coalesce(
            func.sum(
                case(
                    (Transaction.type == "expense", Transaction.amount),
                    else_=0,
                )
            ),
            0,
        ).label("total_expense"),
    ).where(
        Transaction.user_id == user.id,
        Transaction.transaction_date >= start_date,
        Transaction.transaction_date <= end_date,
    )

    totals = db.execute(totals_statement).one()

    total_income = int(totals.total_income or 0)
    total_expense = int(totals.total_expense or 0)

    category_statement = (
        select(
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .join(
            Transaction,
            Transaction.category_id == Category.id,
        )
        .where(
            Transaction.user_id == user.id,
            Transaction.type == "expense",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )
        .group_by(Category.id, Category.name)
        .order_by(func.sum(Transaction.amount).desc())
    )

    expense_by_category = [
        {
            "category_id": row.category_id,
            "category_name": row.category_name,
            "amount": int(row.amount or 0),
        }
        for row in db.execute(category_statement).all()
    ]

    budget_statement = (
        select(
            Budget.category_id,
            Category.name.label("category_name"),
            Budget.amount.label("budget_amount"),
        )
        .join(Category, Category.id == Budget.category_id)
        .where(
            Budget.user_id == user.id,
            Budget.year == year,
            Budget.month == month,
        )
        .order_by(Category.name)
    )

    budget_rows = db.execute(budget_statement).all()

    budgets = []
    for row in budget_rows:
        spent_statement = select(
            func.coalesce(func.sum(Transaction.amount), 0)
        ).where(
            Transaction.user_id == user.id,
            Transaction.category_id == row.category_id,
            Transaction.type == "expense",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )

        spent = int(db.scalar(spent_statement) or 0)
        budget_amount = int(row.budget_amount)

        budgets.append(
            {
                "category_id": row.category_id,
                "category_name": row.category_name,
                "budget_amount": budget_amount,
                "spent_amount": spent,
                "remaining_amount": budget_amount - spent,
                "usage_percent": round(
                    spent * 100 / budget_amount, 2
                ),
            }
        )

    return {
        "period": {
            "year": year,
            "month": month,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
        "total_income": total_income,
        "total_expense": total_expense,
        "balance": total_income - total_expense,
        "expense_by_category": expense_by_category,
        "budgets": budgets,
    }
