from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, DbSession
from app.models import Category, Transaction
from app.schema import (
    TransactionCreate,
    TransactionResponse,
    TransactionUpdate,
)

router = APIRouter(
    prefix="/api/transactions",
    tags=["Transactions"],
)


def validate_category(
    db: Session,
    user_id: int,
    category_id: int | None,
    transaction_type: str,
) -> None:
    if category_id is None:
        return

    category = db.scalar(
        select(Category).where(
            Category.id == category_id,
            (Category.user_id == user_id) | (Category.user_id.is_(None)),
        )
    )

    if category is None:
        raise HTTPException(
            status_code=404,
            detail="دسته‌بندی پیدا نشد یا اجازه دسترسی به آن را ندارید.",
        )

    if category.type != transaction_type:
        raise HTTPException(
            status_code=422,
            detail="نوع دسته‌بندی باید با نوع تراکنش یکسان باشد.",
        )


@router.get("", response_model=list[TransactionResponse])
def list_transactions(
    user: CurrentUser,
    db: DbSession,
    transaction_type: Annotated[
        str | None,
        Query(alias="type", pattern="^(income|expense)$"),
    ] = None,
    start_date: date | None = None,
    end_date: date | None = None,
    category_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.",
        )

    statement = select(Transaction).where(
        Transaction.user_id == user.id
    )

    if transaction_type:
        statement = statement.where(
            Transaction.type == transaction_type
        )

    if start_date:
        statement = statement.where(
            Transaction.transaction_date >= start_date
        )

    if end_date:
        statement = statement.where(
            Transaction.transaction_date <= end_date
        )

    if category_id is not None:
        statement = statement.where(
            Transaction.category_id == category_id
        )

    statement = (
        statement
        .order_by(
            Transaction.transaction_date.desc(),
            Transaction.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    )

    return db.scalars(statement).all()


@router.post(
    "",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_transaction(
    data: TransactionCreate,
    user: CurrentUser,
    db: DbSession,
):
    validate_category(
        db,
        user.id,
        data.category_id,
        data.type,
    )

    transaction = Transaction(
        user_id=user.id,
        type=data.type,
        title=data.title.strip(),
        amount=data.amount,
        transaction_date=data.transaction_date,
        category_id=data.category_id,
        payment_method=data.payment_method,
        description=data.description,
    )

    if not transaction.title:
        raise HTTPException(
            status_code=422,
            detail="عنوان تراکنش نمی‌تواند خالی باشد.",
        )

    db.add(transaction)
    db.commit()
    db.refresh(transaction)

    return transaction


@router.patch(
    "/{transaction_id}",
    response_model=TransactionResponse,
)
def update_transaction(
    transaction_id: int,
    data: TransactionUpdate,
    user: CurrentUser,
    db: DbSession,
):
    transaction = db.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == user.id,
        )
    )

    if transaction is None:
        raise HTTPException(
            status_code=404,
            detail="تراکنش پیدا نشد.",
        )

    changes = data.model_dump(exclude_unset=True)
    new_type = changes.get("type", transaction.type)
    new_category_id = changes.get(
        "category_id",
        transaction.category_id,
    )

    validate_category(
        db,
        user.id,
        new_category_id,
        new_type,
    )

    if "title" in changes:
        changes["title"] = changes["title"].strip()

        if not changes["title"]:
            raise HTTPException(
                status_code=422,
                detail="عنوان تراکنش نمی‌تواند خالی باشد.",
            )

    for field, value in changes.items():
        setattr(transaction, field, value)

    db.commit()
    db.refresh(transaction)

    return transaction


@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_transaction(
    transaction_id: int,
    user: CurrentUser,
    db: DbSession,
):
    transaction = db.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == user.id,
        )
    )

    if transaction is None:
        raise HTTPException(
            status_code=404,
            detail="تراکنش پیدا نشد.",
        )

    db.delete(transaction)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)