"""Authenticated API endpoints for Finova analytics."""
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select

from app.analytics.association import discover_expense_patterns
from app.analytics.clustering import cluster_financial_months
from app.analytics.forecasting import forecast_monthly_expenses
from app.analytics.preprocessing import build_monthly_financial_data
from app.analytics.schemas import ClustersResponse, ForecastResponse, PatternsResponse
from app.dependencies import CurrentUser, DbSession
from app.models import Category

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


def _load_user_data(db, user_id: int, months: int):
    try:
        return build_monthly_financial_data(db, user_id, months=months)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _check_category(db, user_id: int, category_id: int | None) -> None:
    if category_id is None:
        return
    category = db.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.type == "expense",
            or_(Category.user_id == user_id, Category.user_id.is_(None)),
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="دسته‌بندی هزینه پیدا نشد یا قابل دسترسی نیست.")


@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(
    user: CurrentUser,
    db: DbSession,
    horizon: int = Query(default=3, ge=1, le=6),
    months: int = Query(default=36, ge=6, le=60),
    category_id: int | None = Query(default=None, ge=1),
    include_evaluation: bool = False,
):
    _check_category(db, user.id, category_id)
    data = _load_user_data(db, user.id, months)
    try:
        return forecast_monthly_expenses(
            data,
            horizon=horizon,
            category_id=category_id,
            include_evaluation=include_evaluation,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/patterns", response_model=PatternsResponse)
def get_expense_patterns(
    user: CurrentUser,
    db: DbSession,
    months: int = Query(default=12, ge=1, le=60),
    bucket: str = Query(default="day", pattern="^(day|week)$"),
    min_support: float = Query(default=0.10, gt=0, le=1),
    min_confidence: float = Query(default=0.50, gt=0, le=1),
    min_lift: float = Query(default=1.0, ge=0),
    min_occurrences: int = Query(default=3, ge=1, le=1000),
):
    data = _load_user_data(db, user.id, months)
    try:
        return discover_expense_patterns(
            data["records"],
            bucket=bucket,
            min_support=min_support,
            min_confidence=min_confidence,
            min_lift=min_lift,
            min_occurrences=min_occurrences,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/clusters", response_model=ClustersResponse)
def get_financial_clusters(
    user: CurrentUser,
    db: DbSession,
    months: int = Query(default=24, ge=4, le=60),
    max_clusters: int = Query(default=4, ge=2, le=8),
    min_active_months: int = Query(default=12, ge=4, le=60),
):
    data = _load_user_data(db, user.id, months)
    try:
        return cluster_financial_months(
            data,
            max_clusters=max_clusters,
            min_active_months=min_active_months,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
