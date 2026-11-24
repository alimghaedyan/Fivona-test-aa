"""Apriori association-rule mining over time-bucketed expense categories."""
from __future__ import annotations

from typing import Any

from app.analytics.preprocessing import build_baskets


def discover_expense_patterns(
    records: list[dict[str, Any]],
    *,
    bucket: str = "day",
    min_support: float = 0.10,
    min_confidence: float = 0.50,
    min_lift: float = 1.0,
    min_occurrences: int = 3,
    max_rules: int = 50,
) -> dict[str, Any]:
    if not 0 < min_support <= 1:
        raise ValueError("min_support باید بزرگ‌تر از صفر و حداکثر ۱ باشد.")
    if not 0 < min_confidence <= 1:
        raise ValueError("min_confidence باید بزرگ‌تر از صفر و حداکثر ۱ باشد.")
    if min_lift < 0:
        raise ValueError("min_lift نمی‌تواند منفی باشد.")
    if min_occurrences < 1:
        raise ValueError("min_occurrences باید حداقل ۱ باشد.")

    baskets = build_baskets(records, bucket=bucket)
    unique_items = sorted({item for basket in baskets for item in basket})
    result: dict[str, Any] = {
        "algorithm": "apriori",
        "bucket": bucket,
        "basket_count": len(baskets),
        "category_count": len(unique_items),
        "parameters": {
            "min_support": min_support,
            "min_confidence": min_confidence,
            "min_lift": min_lift,
            "min_occurrences": min_occurrences,
        },
        "rules": [],
        "frequent_itemsets": [],
        "status": "ok",
        "warning": None,
    }

    if len(baskets) < min_occurrences:
        result.update(status="insufficient_data", warning="برای استخراج الگو، سبدهای بیشتری لازم است.")
        return result
    if len(unique_items) < 2:
        result.update(status="insufficient_data", warning="حداقل دو دسته هزینه متفاوت برای کشف ارتباط لازم است.")
        return result

    try:
        import pandas as pd
        from mlxtend.frequent_patterns import apriori, association_rules
        from mlxtend.preprocessing import TransactionEncoder
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError("کتابخانه mlxtend نصب نیست. وابستگی‌های Backend را نصب کنید.") from exc

    encoder = TransactionEncoder()
    encoded = encoder.fit(baskets).transform(baskets)
    one_hot = pd.DataFrame(encoded, columns=encoder.columns_, dtype=bool)
    itemsets = apriori(
        one_hot,
        min_support=min_support,
        use_colnames=True,
        max_len=3,
        low_memory=True,
    )
    if itemsets.empty:
        result.update(status="no_patterns", warning="با آستانه فعلی، مجموعه پرتکراری پیدا نشد.")
        return result

    result["frequent_itemsets"] = [
        {
            "items": sorted(str(item) for item in row.itemsets),
            "support": round(float(row.support), 4),
            "occurrences": int(round(float(row.support) * len(baskets))),
        }
        for row in itemsets.itertuples(index=False)
        if int(round(float(row.support) * len(baskets))) >= min_occurrences
    ][:50]

    rules_frame = association_rules(
        itemsets,
        metric="confidence",
        min_threshold=min_confidence,
    )
    if rules_frame.empty:
        result.update(status="no_rules", warning="مجموعه پرتکرار پیدا شد، اما قانون انجمنی با آستانه فعلی به دست نیامد.")
        return result

    rules = []
    for row in rules_frame.itertuples(index=False):
        support = float(getattr(row, "support"))
        confidence = float(getattr(row, "confidence"))
        lift = float(getattr(row, "lift"))
        occurrences = int(round(support * len(baskets)))
        if lift < min_lift or occurrences < min_occurrences:
            continue
        antecedents = sorted(str(item) for item in getattr(row, "antecedents"))
        consequents = sorted(str(item) for item in getattr(row, "consequents"))
        rules.append({
            "antecedents": antecedents,
            "consequents": consequents,
            "support": round(support, 4),
            "confidence": round(confidence, 4),
            "lift": round(lift, 4),
            "occurrences": occurrences,
        })

    rules.sort(key=lambda item: (item["lift"], item["confidence"], item["support"]), reverse=True)
    result["rules"] = rules[:max_rules]
    if not rules:
        result.update(status="no_rules", warning="قوانین استخراج‌شده حداقل تعداد وقوع یا Lift موردنیاز را ندارند.")
    return result
