"""K-Means segmentation of a single user's monthly financial behavior."""
from __future__ import annotations

from collections import defaultdict
from typing import Any


def cluster_financial_months(
    monthly_data: dict[str, Any],
    *,
    max_clusters: int = 4,
    min_active_months: int = 12,
) -> dict[str, Any]:
    if not 2 <= max_clusters <= 8:
        raise ValueError("max_clusters باید بین ۲ و ۸ باشد.")
    if not 4 <= min_active_months <= 60:
        raise ValueError("min_active_months باید بین ۴ و ۶۰ باشد.")

    from app.analytics.preprocessing import build_cluster_features

    feature_names, matrix, active_months = build_cluster_features(monthly_data["months"])
    base = {
        "algorithm": "kmeans",
        "samples": len(matrix),
        "requested_max_clusters": max_clusters,
        "feature_names": feature_names,
        "clusters": [],
        "assignments": [],
        "status": "ok",
        "warning": None,
    }
    if len(matrix) < min_active_months:
        base.update(
            status="insufficient_data",
            warning=f"برای خوشه‌بندی حداقل {min_active_months} ماه دارای تراکنش لازم است.",
        )
        return base

    try:
        import numpy as np
        from sklearn.cluster import KMeans
        from sklearn.metrics import silhouette_score
        from sklearn.preprocessing import StandardScaler
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError("کتابخانه scikit-learn نصب نیست. وابستگی‌های Backend را نصب کنید.") from exc

    values = np.asarray(matrix, dtype=float)
    # Remove constant columns before scaling; they cannot help separate clusters.
    variable_mask = np.nanstd(values, axis=0) > 1e-10
    values = values[:, variable_mask]
    kept_features = [name for name, keep in zip(feature_names, variable_mask.tolist()) if keep]
    base["feature_names"] = kept_features
    if values.shape[1] == 0 or len({tuple(row) for row in values.tolist()}) < 2:
        base.update(status="low_variation", warning="ماه‌های ثبت‌شده تفاوت کافی برای تشکیل خوشه‌های معنادار ندارند.")
        return base

    scaled = StandardScaler().fit_transform(values)
    max_k = min(max_clusters, len(matrix) - 1, len({tuple(row) for row in scaled.tolist()}))
    candidates: list[tuple[int, float, Any]] = []
    for k in range(2, max_k + 1):
        model = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = model.fit_predict(scaled)
        if len(set(labels.tolist())) < 2 or len(set(labels.tolist())) >= len(matrix):
            continue
        try:
            score = float(silhouette_score(scaled, labels))
        except ValueError:
            continue
        candidates.append((k, score, model))

    if not candidates:
        base.update(status="low_variation", warning="با داده‌های موجود تعداد خوشه معتبر پیدا نشد.")
        return base

    selected_k, silhouette, selected_model = max(candidates, key=lambda item: item[1])
    raw_labels = selected_model.labels_.tolist()
    expense_by_label: dict[int, list[int]] = defaultdict(list)
    periods_by_label: dict[int, list[str]] = defaultdict(list)
    for row, label in zip(active_months, raw_labels):
        expense_by_label[int(label)].append(int(row["expense"]))
        periods_by_label[int(label)].append(row["period"])

    # Relabel clusters by their average expense so labels are understandable
    # and stable in presentation (low expense first), not by arbitrary KMeans ID.
    ordered_labels = sorted(
        expense_by_label,
        key=lambda label: sum(expense_by_label[label]) / len(expense_by_label[label]),
    )
    if len(ordered_labels) == 2:
        label_names = {1: "الگوی کم‌هزینه", 2: "الگوی پرهزینه"}
    else:
        label_names = {1: "الگوی کم‌هزینه", 2: "الگوی متوسط", 3: "الگوی پرهزینه"}
    remap = {old: new for new, old in enumerate(ordered_labels, start=1)}
    clusters = []
    for old_label in ordered_labels:
        samples = expense_by_label[old_label]
        new_label = remap[old_label]
        clusters.append({
            "cluster_id": new_label,
            "label": label_names.get(new_label, f"الگوی {new_label}"),
            "month_count": len(samples),
            "average_expense": int(round(sum(samples) / len(samples))),
            "median_expense": int(round(float(np.median(samples)))),
            "periods": sorted(periods_by_label[old_label]),
        })

    assignments = []
    for row, old_label in zip(active_months, raw_labels):
        assignments.append({
            **row,
            "cluster_id": remap[int(old_label)],
            "cluster_label": label_names.get(remap[int(old_label)], f"الگوی {remap[int(old_label)]}"),
        })

    base.update({
        "selected_k": selected_k,
        "silhouette_score": round(silhouette, 4),
        "candidate_scores": [
            {"k": k, "silhouette": round(score, 4)}
            for k, score, _ in candidates
        ],
        "clusters": clusters,
        "assignments": assignments,
        "scaler": "StandardScaler",
        "random_state": 42,
    })
    return base
