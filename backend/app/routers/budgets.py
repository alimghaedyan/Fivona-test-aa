
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.dependencies import CurrentUser, DbSession
from app.models import Budget, Category
from app.schema import BudgetCreate, BudgetUpdate, BudgetResponse


router = APIRouter(
    prefix="/api/budgets",
    tags=["Budgets"],
)


# =========================================================
# GET: نمایش بودجه‌ها
# =========================================================

@router.get("/", response_model=list[BudgetResponse])
def get_budgets(
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=1300, le=1500),
    month: int | None = Query(default=None, ge=1, le=12),
):
    statement = select(Budget).where(
        Budget.user_id == current_user.id
    )

    if year is not None:
        statement = statement.where(Budget.year == year)

    if month is not None:
        statement = statement.where(Budget.month == month)

    statement = statement.order_by(
        Budget.year.desc(),
        Budget.month.desc(),
        Budget.id.desc(),
    )

    return db.scalars(statement).all()


# =========================================================
# POST: ایجاد بودجه جدید
# =========================================================

@router.post(
    "/",
    response_model=BudgetResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_budget(
    data: BudgetCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    category = db.scalar(
        select(Category).where(
            Category.id == data.category_id,
            Category.type == "expense",
            (
                (Category.user_id == current_user.id)
                | (Category.user_id.is_(None))
            ),
        )
    )

    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="دسته هزینه پیدا نشد یا قابل استفاده نیست.",
        )

    existing_budget = db.scalar(
        select(Budget).where(
            Budget.user_id == current_user.id,
            Budget.category_id == data.category_id,
            Budget.year == data.year,
            Budget.month == data.month,
        )
    )

    if existing_budget:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="برای این دسته در این ماه قبلاً بودجه ثبت شده است.",
        )

    budget = Budget(
        user_id=current_user.id,
        category_id=data.category_id,
        year=data.year,
        month=data.month,
        amount=data.amount,
    )

    try:
        db.add(budget)
        db.commit()
        db.refresh(budget)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ثبت بودجه انجام نشد؛ ممکن است این بودجه قبلاً ثبت شده باشد.",
        )

    return budget


# =========================================================
# PATCH: ویرایش مبلغ بودجه
# =========================================================

@router.patch("/{budget_id}", response_model=BudgetResponse)
def update_budget(
    budget_id: int,
    data: BudgetUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    budget = db.scalar(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.user_id == current_user.id,
        )
    )

    if budget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="بودجه پیدا نشد.",
        )

    updates = data.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="مبلغ جدیدی برای تغییر ارسال نشده است.",
        )

    for field, value in updates.items():
        setattr(budget, field, value)

    db.commit()
    db.refresh(budget)

    return budget


# =========================================================
# DELETE: حذف بودجه
# =========================================================

@router.delete(
    "/{budget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_budget(
    budget_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    budget = db.scalar(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.user_id == current_user.id,
        )
    )

    if budget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="بودجه پیدا نشد.",
        )

    db.delete(budget)
    db.commit()

    return None
