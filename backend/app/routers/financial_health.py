
from datetime import date, timedelta

import jdatetime
from fastapi import APIRouter, Query
from sqlalchemy import select, func

from app.dependencies import CurrentUser, DbSession
from app.models import Transaction, Budget, Category


router = APIRouter(
    prefix="/api/financial-health",
    tags=["Financial Health"],
)


def get_month_range(year: int, month: int) -> tuple[date, date]:
    start = jdatetime.date(year, month, 1).togregorian()

    if month == 12:
        next_month = jdatetime.date(year + 1, 1, 1)
    else:
        next_month = jdatetime.date(year, month + 1, 1)

    end = next_month.togregorian() - timedelta(days=1)

    return start, end


@router.get("/score")
def get_financial_health(
    user: CurrentUser,
    db: DbSession,
    year: int = Query(ge=1300, le=1500),
    month: int = Query(ge=1, le=12),
):
    start_date, end_date = get_month_range(year, month)

    # مجموع درآمد ماه
    income_query = select(
        func.coalesce(func.sum(Transaction.amount), 0)
    ).where(
        Transaction.user_id == user.id,
        Transaction.type == "income",
        Transaction.transaction_date >= start_date,
        Transaction.transaction_date <= end_date,
    )

    total_income = int(db.scalar(income_query) or 0)

    # مجموع هزینه ماه
    expense_query = select(
        func.coalesce(func.sum(Transaction.amount), 0)
    ).where(
        Transaction.user_id == user.id,
        Transaction.type == "expense",
        Transaction.transaction_date >= start_date,
        Transaction.transaction_date <= end_date,
    )

    total_expense = int(db.scalar(expense_query) or 0)

    # شاخص اول: نرخ پس‌انداز، از 40 امتیاز
    if total_income > 0:
        savings_rate = (
            (total_income - total_expense) / total_income
        ) * 100

        savings_score = round(
            max(0, min(100, savings_rate)) * 0.4
        )
    else:
        savings_rate = None
        savings_score = 0

    # شاخص دوم: کنترل هزینه‌ها، از 30 امتیاز
    if total_income > 0:
        expense_ratio = total_expense / total_income

        if expense_ratio <= 0.5:
            expense_score = 30
        elif expense_ratio <= 0.7:
            expense_score = 25
        elif expense_ratio <= 0.9:
            expense_score = 15
        elif expense_ratio <= 1:
            expense_score = 5
        else:
            expense_score = 0
    else:
        expense_ratio = None
        expense_score = 0

    # شاخص سوم: رعایت بودجه، از 30 امتیاز
    budget_query = (
        select(Budget.category_id, Budget.amount)
        .where(
            Budget.user_id == user.id,
            Budget.year == year,
            Budget.month == month,
        )
    )

    budget_rows = db.execute(budget_query).all()

    budget_total = 0
    budget_spent_total = 0

    for budget in budget_rows:
        budget_total += int(budget.amount)

        spent_query = select(
            func.coalesce(func.sum(Transaction.amount), 0)
        ).where(
            Transaction.user_id == user.id,
            Transaction.category_id == budget.category_id,
            Transaction.type == "expense",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )

        budget_spent_total += int(db.scalar(spent_query) or 0)

    if budget_total > 0:
        budget_usage = budget_spent_total / budget_total

        if budget_usage <= 0.8:
            budget_score = 30
        elif budget_usage <= 1:
            budget_score = 20
        else:
            budget_score = 0
    else:
        budget_usage = None
        budget_score = 0

    # امتیاز نهایی از 100
    total_score = min(
        100,
        savings_score + expense_score + budget_score,
    )

    if total_income == 0:
        status_text = "اطلاعات درآمد کافی نیست"
    elif total_score >= 80:
        status_text = "عالی"
    elif total_score >= 60:
        status_text = "خوب"
    elif total_score >= 40:
        status_text = "متوسط"
    else:
        status_text = "نیازمند بهبود"

    return {
        "period": {
            "year": year,
            "month": month,
        },
        "financial_health_score": total_score,
        "status": status_text,
        "total_income": total_income,
        "total_expense": total_expense,
        "balance": total_income - total_expense,
        "savings_rate_percent": (
            round(savings_rate, 2)
            if savings_rate is not None
            else None
        ),
        "expense_to_income_percent": (
            round(expense_ratio * 100, 2)
            if expense_ratio is not None
            else None
        ),
        "budget": {
            "total_budget": budget_total,
            "total_spent": budget_spent_total,
            "usage_percent": (
                round(budget_usage * 100, 2)
                if budget_usage is not None
                else None
            ),
            "budget_count": len(budget_rows),
        },
        "score_breakdown": {
            "savings_score": savings_score,
            "expense_control_score": expense_score,
            "budget_score": budget_score,
        },
        "note": (
            "این امتیاز یک شاخص ساده آموزشی است و "
            "ارزیابی قطعی وضعیت مالی محسوب نمی‌شود."
        ),
    }
