from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app import models
from app.database import Base, get_db
from app.main import app

ORIGIN = "http://localhost:5173"


def _client_for_test_database():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return test_engine, testing_session


def test_analytics_endpoints_require_authenticated_session():
    test_engine, _session = _client_for_test_database()
    try:
        with TestClient(app) as client:
            assert client.get("/api/analytics/forecast?months=6").status_code == 401
            assert client.get("/api/analytics/patterns?months=6").status_code == 401
            assert client.get("/api/analytics/clusters?months=6").status_code == 401
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def test_empty_account_gets_explicit_insufficient_data_responses():
    test_engine, _session = _client_for_test_database()
    try:
        with TestClient(app) as client:
            headers = {"Origin": ORIGIN}
            registered = client.post(
                "/api/auth/register",
                json={
                    "email": "analytics-empty@example.com",
                    "password": "A-strong-password-2026!",
                    "display_name": "Analytics Empty",
                },
                headers=headers,
            )
            assert registered.status_code == 201
            login = client.post(
                "/api/auth/login",
                json={"email": "analytics-empty@example.com", "password": "A-strong-password-2026!"},
                headers=headers,
            )
            assert login.status_code == 200

            forecast = client.get("/api/analytics/forecast?months=6&horizon=1")
            patterns = client.get("/api/analytics/patterns?months=6")
            clusters = client.get("/api/analytics/clusters?months=6&min_active_months=4")

            assert forecast.status_code == 200
            assert forecast.json()["method"] == "wma_fallback"
            assert forecast.json()["predictions"] == []
            assert forecast.json()["warning"]

            assert patterns.status_code == 200
            assert patterns.json()["status"] == "insufficient_data"
            assert patterns.json()["basket_count"] == 0

            assert clusters.status_code == 200
            assert clusters.json()["status"] == "insufficient_data"
            assert clusters.json()["samples"] == 0
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()
