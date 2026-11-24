# Finova Analytics Upgrade v1

Adds the following capabilities to the existing `Fivona_R` repository:

- Prophet forecasting with WMA fallback/baseline and optional walk-forward evaluation.
- Apriori association-rule mining over daily or weekly expense baskets.
- K-Means segmentation of monthly financial behavior with StandardScaler and Silhouette selection.
- Authenticated FastAPI endpoints under `/api/analytics`.
- React Prophet forecast panel, a dashboard KPI badge, and the new `#/insights` page.
- Analytics service tests and updated backend requirements.

This is an overlay/upgrade package, not a full copy of the original repository. Run `apply_analytics_upgrade.py` against your local Finova repository root. The script creates backups before modifying integration points.
