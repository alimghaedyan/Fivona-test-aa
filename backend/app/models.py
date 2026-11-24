
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# =========================================================
# Users
# =========================================================

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    email: Mapped[str] = mapped_column(
        String(254), unique=True, index=True, nullable=False
    )

    password_hash: Mapped[str] = mapped_column(
        String(255), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    # Incrementing this value immediately invalidates all previously issued JWTs.
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    profile: Mapped["Profile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    budgets: Mapped[list["Budget"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


# =========================================================
# Profiles
# =========================================================

class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    display_name: Mapped[str] = mapped_column(
        String(100), default="", nullable=False
    )

    preferences: Mapped[str] = mapped_column(
        Text, default="{}", nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="profile")


# =========================================================
# Categories
# =========================================================

class Category(Base):
    __tablename__ = "categories"

    __table_args__ = (
        CheckConstraint(
            "type IN ('income', 'expense')",
            name="ck_categories_type",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )

    type: Mapped[str] = mapped_column(
        String(10), nullable=False
    )

    is_default: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )


# =========================================================
# Transactions
# =========================================================

class Transaction(Base):
    __tablename__ = "transactions"

    __table_args__ = (
        CheckConstraint(
            "type IN ('income', 'expense')",
            name="ck_transactions_type",
        ),
        CheckConstraint(
            "amount > 0",
            name="ck_transactions_amount",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    type: Mapped[str] = mapped_column(
        String(10), nullable=False
    )

    title: Mapped[str] = mapped_column(
        String(200), nullable=False
    )

    # مبلغ به تومان و به صورت عدد صحیح
    amount: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    transaction_date: Mapped[date] = mapped_column(
        Date, nullable=False, index=True
    )

    payment_method: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )

    description: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    # آخرین زمان ویرایش رکورد؛ برای مرتب‌سازی «آخرین تغییرات» در رابط کاربری
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=True
    )

    user: Mapped["User"] = relationship(
        back_populates="transactions"
    )


# =========================================================
# Budgets
# =========================================================

class Budget(Base):
    __tablename__ = "budgets"

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "category_id",
            "year",
            "month",
            name="uq_budget_user_category_period",
        ),
        CheckConstraint(
            "amount > 0",
            name="ck_budgets_amount",
        ),
        CheckConstraint(
            "month BETWEEN 1 AND 12",
            name="ck_budgets_month",
        ),
        CheckConstraint(
            "year BETWEEN 1300 AND 1500",
            name="ck_budgets_year",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=False,
    )

    year: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    month: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    # سقف بودجه به تومان
    amount: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    user: Mapped["User"] = relationship(
        back_populates="budgets"
    )


# =========================================================
# Security audit and authentication throttling
# =========================================================

class SecurityEvent(Base):
    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    email_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    ip_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
