
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, DbSession
from app.models import Category
from app.schema import (
    CategoryCreate,
    CategoryUpdate,
    CategoryResponse,
)


router = APIRouter(
    prefix="/api/categories",
    tags=["Categories"],
)


@router.get("/", response_model=list[CategoryResponse])
def get_categories(
    db: DbSession,
    current_user: CurrentUser,
):
    statement = (
        select(Category)
        .where(
            (Category.user_id == current_user.id)
            | (Category.user_id.is_(None))
        )
        .order_by(Category.type, Category.name)
    )

    return db.scalars(statement).all()


@router.post(
    "/",
    response_model=CategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    data: CategoryCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    name = data.name.strip()

    if not name:
        raise HTTPException(
            status_code=422,
            detail="نام دسته‌بندی نمی‌تواند خالی باشد.",
        )

    statement = select(Category).where(
        Category.user_id == current_user.id,
        Category.name == name,
        Category.type == data.type,
    )

    if db.scalar(statement):
        raise HTTPException(
            status_code=409,
            detail="این دسته‌بندی قبلاً ایجاد شده است.",
        )

    category = Category(
        user_id=current_user.id,
        name=name,
        type=data.type,
        is_default=False,
    )

    db.add(category)
    db.commit()
    db.refresh(category)

    return category


@router.patch("/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    category = db.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.user_id == current_user.id,
        )
    )

    if category is None:
        raise HTTPException(
            status_code=404,
            detail="دسته‌بندی پیدا نشد یا اجازه ویرایش آن را ندارید.",
        )

    updates = data.model_dump(exclude_unset=True)

    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"].strip()

        if not updates["name"]:
            raise HTTPException(
                status_code=422,
                detail="نام دسته‌بندی نمی‌تواند خالی باشد.",
            )

    new_name = updates.get("name", category.name)
    new_type = updates.get("type", category.type)

    duplicate = db.scalar(
        select(Category).where(
            Category.user_id == current_user.id,
            Category.name == new_name,
            Category.type == new_type,
            Category.id != category.id,
        )
    )

    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="دسته‌بندی دیگری با همین نام و نوع وجود دارد.",
        )

    for field, value in updates.items():
        setattr(category, field, value)

    db.commit()
    db.refresh(category)

    return category


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_category(
    category_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    category = db.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.user_id == current_user.id,
        )
    )

    if category is None:
        raise HTTPException(
            status_code=404,
            detail="دسته‌بندی پیدا نشد یا اجازه حذف آن را ندارید.",
        )

    db.delete(category)
    db.commit()

    return None
