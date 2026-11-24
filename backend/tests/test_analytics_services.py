from datetime import date

import pytest

from app.analytics.association import discover_expense_patterns
from app.analytics.clustering import cluster_financial_months
from app.analytics.forecasting import forecast_monthly_expenses, weighted_moving_average
from app.analytics.preprocessing import build_baskets, build_cluster_features


def test_weighted_moving_average_weights_recent_months_more():
    assert weighted_moving_average([10, 12, 15]) == pytest.approx(13.1666666667)
    assert weighted_moving_average([10]) is None


def test_baskets_are_deduplicated_per_day():
    rows = [
        {"type": "expense", "date": "2026-01-01", "category": "خوراک"},
        {"type": "expense", "date": "2026-01-01", "category": "خوراک"},
        {"type": "expense", "date": "2026-01-01", "category": "حمل‌ونقل"},
        {"type": "income", "date": "2026-01-01", "category": "حقوق"},
        {"type": "expense", "date": "2026-01-02", "category": "خوراک"},
    ]
    baskets = build_baskets(rows, bucket="day")
    assert baskets == [{"خوراک", "حمل‌ونقل"}, {"خوراک"}]


def test_weekly_baskets_group_dates_in_same_week():
    rows = [
        {"type": "expense", "date": "2026-01-05", "category": "خوراک"},
        {"type": "expense", "date": "2026-01-10", "category": "حمل‌ونقل"},
    ]
    assert build_baskets(rows, bucket="week") == [{"خوراک", "حمل‌ونقل"}]


def _monthly_data():
    months = []
    for index in range(24):
        high = index >= 12
        expense = 30_000_000 if high else 8_000_000
        income = 40_000_000 if high else 25_000_000
        months.append({
            "period": f"1404-{index % 12 + 1:02d}" if index < 12 else f"1405-{index % 12 + 1:02d}",
            "income": income,
            "expense": expense,
            "income_count": 1,
            "expense_count": 3,
            "budget_total": expense * (0.9 if high else 1.4),
            "budget_usage": 1.1 if high else 0.7,
            "expense_by_category": {
                "خوراک": int(expense * 0.5),
                "حمل‌ونقل": int(expense * 0.3),
                "سرگرمی": int(expense * 0.2),
            },
        })
    return {"keys": [item["period"] for item in months], "months": months, "records": [], "categories": {}}


def test_cluster_feature_matrix_has_expected_shape():
    data = _monthly_data()
    names, matrix, active = build_cluster_features(data["months"])
    assert len(names) == len(matrix[0])
    assert len(matrix) == 24
    assert len(active) == 24


def test_kmeans_clusters_financial_months_when_data_is_sufficient():
    result = cluster_financial_months(_monthly_data(), max_clusters=3, min_active_months=12)
    assert result["status"] in {"ok", "low_variation"}
    if result["status"] == "ok":
        assert result["selected_k"] >= 2
        assert result["samples"] == 24
        assert result["silhouette_score"] is not None


def test_apriori_returns_insufficient_data_message_for_tiny_history():
    result = discover_expense_patterns([], min_occurrences=3)
    assert result["status"] == "insufficient_data"
    assert result["rules"] == []


def test_apriori_extracts_rule_from_repeated_baskets():
    rows = []
    basket_rows = [
        ("2026-01-01", ["خوراک", "حمل‌ونقل"]),
        ("2026-01-02", ["خوراک", "حمل‌ونقل"]),
        ("2026-01-03", ["خوراک", "حمل‌ونقل"]),
        ("2026-01-04", ["خوراک"]),
        ("2026-01-05", ["خوراک", "حمل‌ونقل"]),
    ]
    for tx_date, categories in basket_rows:
        rows.extend({"type": "expense", "date": tx_date, "category": category} for category in categories)
    result = discover_expense_patterns(rows, min_support=0.2, min_confidence=0.5, min_lift=1.0, min_occurrences=2)
    assert result["basket_count"] == 5
    assert result["status"] in {"ok", "no_rules", "no_patterns"}


def test_forecast_uses_wma_fallback_below_prophet_history_threshold():
    data = _monthly_data()
    data["keys"] = data["keys"][-12:]
    data["months"] = data["months"][-12:]
    result = forecast_monthly_expenses(data, horizon=3)
    assert result["method"] == "wma_fallback"
    assert len(result["predictions"]) == 3
    assert all(row["lower"] is None for row in result["predictions"])
