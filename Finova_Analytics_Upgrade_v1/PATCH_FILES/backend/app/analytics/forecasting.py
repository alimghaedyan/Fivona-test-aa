"""Prophet forecasting with a weighted-moving-average baseline."""
from __future__ import annotations

from datetime import date
from math import sqrt
from typing import Any

import jdatetime

from app.analytics.preprocessing import month_expense_values, parse_month_key, shift_jalali_month

MIN_PROPHET_MONTHS = 24
YEARLY_SEASONALITY_MONTHS = 36
MIN_ACTIVE_MONTHS = 8


def weighted_moving_average(values: list[float], window: int = 3) -> float | None:
    recent = [float(value) for value in values[-window:]]
    if sum(value > 0 for value in recent) < 2:
        return None
    weights = list(range(1, len(recent) + 1))
    return sum(value * weight for value, weight in zip(recent, weights)) / sum(weights)


def _metrics(actual: list[float], predicted: list[float]) -> dict[str, float | None]:
    if not actual:
        return {"mae": None, "rmse": None, "wape": None, "samples": 0}
    errors = [a - p for a, p in zip(actual, predicted)]
    mae = sum(abs(error) for error in errors) / len(errors)
    rmse = sqrt(sum(error * error for error in errors) / len(errors))
    denominator = sum(abs(value) for value in actual)
    wape = sum(abs(error) for error in errors) / denominator if denominator else None
    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "wape": round(wape, 4) if wape is not None else None,
        "samples": len(actual),
    }


def _prophet_model(*, yearly_seasonality: bool, uncertainty_samples: int = 300):
    try:
        from prophet import Prophet
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError("کتابخانه Prophet نصب نیست. وابستگی‌های Backend را نصب کنید.") from exc

    return Prophet(
        growth="linear",
        yearly_seasonality=yearly_seasonality,
        weekly_seasonality=False,
        daily_seasonality=False,
        seasonality_mode="additive",
        interval_width=0.80,
        uncertainty_samples=uncertainty_samples,
        changepoint_prior_scale=0.05,
    )


def _date_for_period(period: str) -> date:
    year, month = parse_month_key(period)
    return jdatetime.date(year, month, 1).togregorian()


def walk_forward_evaluation(
    periods: list[str],
    values: list[int],
    *,
    max_folds: int = 3,
    min_train_months: int = 18,
) -> dict[str, Any]:
    """Expanding-window next-observed-month evaluation; no future values enter training."""
    if len(values) < min_train_months + 1:
        return {
            "available": False,
            "reason": "برای ارزیابی زمانی، سابقه طولانی‌تری لازم است.",
            "prophet": _metrics([], []),
            "wma": _metrics([], []),
        }

    test_indices = list(range(max(min_train_months, len(values) - max_folds), len(values)))
    actual_values: list[float] = []
    prophet_values: list[float] = []
    wma_values: list[float] = []

    for index in test_indices:
        train_values = [float(value) for value in values[:index]]
        if sum(value > 0 for value in train_values) < MIN_ACTIVE_MONTHS:
            continue
        try:
            import pandas as pd

            train_frame = pd.DataFrame({
                "ds": [_date_for_period(period) for period in periods[:index]],
                "y": train_values,
            })
            model = _prophet_model(
                yearly_seasonality=len(train_values) >= YEARLY_SEASONALITY_MONTHS,
                uncertainty_samples=0,
            )
            model.fit(train_frame)
            prediction = model.predict(pd.DataFrame({"ds": [_date_for_period(periods[index])]}))
            prophet_value = max(0.0, float(prediction.iloc[0]["yhat"]))
        except Exception:
            # A failed fold is excluded; the caller receives the number of valid folds.
            continue

        baseline = weighted_moving_average(train_values)
        if baseline is None:
            continue
        actual_values.append(float(values[index]))
        prophet_values.append(prophet_value)
        wma_values.append(float(baseline))

    if not actual_values:
        return {
            "available": False,
            "reason": "هیچ پنجره ارزیابی معتبری ساخته نشد.",
            "prophet": _metrics([], []),
            "wma": _metrics([], []),
        }
    return {
        "available": True,
        "method": "expanding_window_next_observed_month",
        "prophet": _metrics(actual_values, prophet_values),
        "wma": _metrics(actual_values, wma_values),
        "note": "ارزیابی expanding-window روی ماه‌های دارای ثبت هزینه انجام شده؛ هر Fold فقط از مشاهده‌های قبل از ماه هدف استفاده می‌کند.",
    }


def forecast_monthly_expenses(
    monthly_data: dict[str, Any],
    *,
    horizon: int = 3,
    category_id: int | None = None,
    include_evaluation: bool = False,
) -> dict[str, Any]:
    if horizon not in {1, 3, 6}:
        raise ValueError("افق پیش‌بینی باید ۱، ۳ یا ۶ ماه باشد.")

    calendar_periods = monthly_data["keys"]
    all_values = month_expense_values(monthly_data, category_id)
    # Match Finova's existing WMA semantics: months with no expense records are
    # treated as unobserved, while a category absent in an otherwise active
    # expense month is a genuine zero for that category.
    observed_indices = [
        index for index, item in enumerate(monthly_data["months"])
        if item["expense_count"] > 0
    ]
    periods = [calendar_periods[index] for index in observed_indices]
    values = [all_values[index] for index in observed_indices]
    active_months = sum(value > 0 for value in values)
    category_name = monthly_data["categories"].get(category_id) if category_id is not None else None
    category_exists = category_id is None or category_name is not None
    baseline = weighted_moving_average(values)
    history_count = len(values)
    use_prophet = (
        category_exists
        and history_count >= MIN_PROPHET_MONTHS
        and active_months >= MIN_ACTIVE_MONTHS
    )

    future_periods: list[str] = []
    last_year, last_month = parse_month_key(calendar_periods[-1])
    for offset in range(1, horizon + 1):
        future_periods.append(month_key_for(shift_jalali_month(last_year, last_month, offset)))

    predictions: list[dict[str, Any]] = []
    method = "wma_fallback"
    yearly_seasonality = False
    warning: str | None = None

    if not category_exists:
        warning = "دسته‌بندی انتخاب‌شده در حساب کاربر وجود ندارد."
    elif use_prophet:
        try:
            import pandas as pd

            yearly_seasonality = history_count >= YEARLY_SEASONALITY_MONTHS
            frame = pd.DataFrame({
                "ds": [_date_for_period(period) for period in periods],
                "y": [float(value) for value in values],
            })
            model = _prophet_model(yearly_seasonality=yearly_seasonality)
            model.fit(frame)
            future = pd.DataFrame({"ds": [_date_for_period(period) for period in future_periods]})
            predicted = model.predict(future)
            for index, period in enumerate(future_periods):
                row = predicted.iloc[index]
                predictions.append({
                    "period": period,
                    "yhat": int(round(max(0.0, float(row["yhat"])))),
                    "lower": int(round(max(0.0, float(row["yhat_lower"])))),
                    "upper": int(round(max(0.0, float(row["yhat_upper"])))),
                    "wma_baseline": int(round(baseline)) if baseline is not None else None,
                })
            method = "prophet"
        except Exception as exc:
            # Keep the service usable if the statistical model cannot converge.
            warning = f"اجرای Prophet ناموفق بود؛ از WMA به‌عنوان روش جایگزین استفاده شد ({type(exc).__name__})."
            use_prophet = False

    if not category_exists:
        pass
    elif not use_prophet and baseline is None and warning is None:
        warning = "برای محاسبه WMA دست‌کم دو ماه دارای هزینه در سه ماه مشاهده‌شده اخیر لازم است."
    elif not use_prophet and baseline is not None and warning is None:
        warning = (
            f"برای اجرای Prophet دست‌کم {MIN_PROPHET_MONTHS} ماه دارای هزینه و "
            f"{MIN_ACTIVE_MONTHS} ماه فعال در این دسته لازم است؛ اکنون "
            f"{history_count} ماه مشاهده‌شده و {active_months} ماه فعال وجود دارد. "
            "WMA به‌عنوان روش جایگزین نمایش داده می‌شود."
        )

    if not use_prophet and baseline is not None:
        predictions = [
            {
                "period": period,
                "yhat": int(round(baseline)),
                "lower": None,
                "upper": None,
                "wma_baseline": int(round(baseline)),
            }
            for period in future_periods
        ]

    result: dict[str, Any] = {
        "method": method,
        "category_id": category_id,
        "category_name": category_name,
        "horizon": horizon,
        "history_months": history_count,
        "active_months": active_months,
        "yearly_seasonality": yearly_seasonality if method == "prophet" else False,
        "interval_width": 0.80 if method == "prophet" else None,
        "predictions": predictions,
        "baseline": {
            "method": "WMA",
            "value": int(round(baseline)) if baseline is not None else None,
            "window": min(3, history_count),
        },
        "warning": warning,
        "data_period": {
            "from": periods[0] if periods else None,
            "to": periods[-1] if periods else None,
            "calendar_from": calendar_periods[0],
            "calendar_to": calendar_periods[-1],
        },
    }
    if include_evaluation:
        result["evaluation"] = walk_forward_evaluation(periods, values)
    return result


def month_key_for(value: tuple[int, int]) -> str:
    return f"{value[0]:04d}-{value[1]:02d}"
