
from datetime import date, datetime
from typing import Literal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# =========================================================
# Authentication
# =========================================================

class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# =========================================================
# Transactions
# =========================================================

class TransactionCreate(BaseModel):
    type: Literal["income", "expense"]
    title: str = Field(min_length=1, max_length=200)
    amount: int = Field(gt=0)
    transaction_date: date
    category_id: int | None = None
    payment_method: str | None = Field(default=None, max_length=50)
    description: str | None = None


class TransactionUpdate(BaseModel):
    type: Literal["income", "expense"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    amount: int | None = Field(default=None, gt=0)
    transaction_date: date | None = None
    category_id: int | None = None
    payment_method: str | None = Field(default=None, max_length=50)
    description: str | None = None


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    category_id: int | None
    type: str
    title: str
    amount: int
    transaction_date: date
    payment_method: str | None
    description: str | None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# =========================================================
# Categories
# =========================================================

class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: Literal["income", "expense"]


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    type: Literal["income", "expense"] | None = None


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    name: str
    type: str
    is_default: bool


# =========================================================
# Budgets
# =========================================================

class BudgetCreate(BaseModel):
    category_id: int
    year: int = Field(ge=1300, le=1500)
    month: int = Field(ge=1, le=12)
    amount: int = Field(gt=0)


class BudgetUpdate(BaseModel):
    amount: int | None = Field(default=None, gt=0)


class BudgetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    category_id: int
    year: int
    month: int
    amount: int
# =========================================================
# User Profile
# =========================================================
class ProfileUpdate(BaseModel):
    display_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
    )
    preferences: dict[str, Any] | None = None


class ProfileResponse(BaseModel):
    id: int
    email: str
    display_name: str
    preferences: dict[str, Any]


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)