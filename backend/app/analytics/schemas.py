"""Typed response contracts for analytics endpoints."""
from typing import Any
from pydantic import BaseModel, Field


class ForecastPrediction(BaseModel):
    period: str
    yhat: int
    lower: int | None = None
    upper: int | None = None
    wma_baseline: int | None = None


class ForecastResponse(BaseModel):
    method: str
    category_id: int | None = None
    category_name: str | None = None
    horizon: int
    history_months: int
    active_months: int
    yearly_seasonality: bool
    interval_width: float | None = None
    predictions: list[ForecastPrediction]
    baseline: dict[str, Any]
    warning: str | None = None
    data_period: dict[str, Any]
    evaluation: dict[str, Any] | None = None


class PatternsResponse(BaseModel):
    algorithm: str
    bucket: str
    basket_count: int
    category_count: int
    parameters: dict[str, Any]
    rules: list[dict[str, Any]]
    frequent_itemsets: list[dict[str, Any]]
    status: str
    warning: str | None = None


class ClustersResponse(BaseModel):
    algorithm: str
    samples: int
    requested_max_clusters: int
    feature_names: list[str]
    clusters: list[dict[str, Any]]
    assignments: list[dict[str, Any]]
    status: str
    warning: str | None = None
    selected_k: int | None = None
    silhouette_score: float | None = None
    candidate_scores: list[dict[str, Any]] = Field(default_factory=list)
    scaler: str | None = None
    random_state: int | None = None
