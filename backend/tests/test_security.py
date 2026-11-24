import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base, get_db
from app.main import app
from app.models import LoginAttempt, RevokedToken, SecurityEvent, User
from app.security import create_access_token, decode_access_token, hash_password, verify_password
from app import security

ORIGIN = "http://localhost:5500"


@pytest.fixture()
def client_and_session():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, TestingSession
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def test_password_is_argon2_hash_not_plaintext():
    raw = "A-strong-password-2026!"
    stored = hash_password(raw)
    assert stored != raw
    assert stored.startswith("$argon2id$")
    assert verify_password(raw, stored)
    assert not verify_password("wrong-password", stored)


def test_cookie_auth_csrf_logout_and_security_events(client_and_session):
    client, Session = client_and_session
    headers = {"Origin": ORIGIN}
    registered = client.post(
        "/api/auth/register",
        json={"email": "security@example.com", "password": "A-strong-password-2026!", "display_name": "Security Test"},
        headers=headers,
    )
    assert registered.status_code == 201

    with Session() as db:
        user = db.scalar(select(User).where(User.email == "security@example.com"))
        assert user is not None
        assert user.password_hash != "A-strong-password-2026!"
        assert user.password_hash.startswith("$argon2id$")

    login = client.post(
        "/api/auth/login",
        json={"email": "security@example.com", "password": "A-strong-password-2026!"},
        headers=headers,
    )
    assert login.status_code == 200
    assert "access_token" not in login.json()
    cookie_header = login.headers.get("set-cookie", "").lower()
    assert "finova_session=" in cookie_header
    assert "httponly" in cookie_header
    assert "samesite=lax" in cookie_header
    assert client.get("/api/auth/me").status_code == 200

    # A cookie-authenticated state-changing request must carry the CSRF header.
    blocked = client.patch("/api/profile/", json={"display_name": "No CSRF"}, headers=headers)
    assert blocked.status_code == 403
    csrf = client.cookies.get("finova_csrf")
    assert csrf
    changed = client.patch(
        "/api/profile/",
        json={"display_name": "Protected Update"},
        headers={**headers, "X-CSRF-Token": csrf},
    )
    assert changed.status_code == 200

    logout = client.post("/api/auth/logout", headers={**headers, "X-CSRF-Token": csrf})
    assert logout.status_code == 204
    assert client.get("/api/auth/me").status_code == 401

    with Session() as db:
        events = {x.event_type for x in db.scalars(select(SecurityEvent)).all()}
        assert {"registration_success", "login_success", "logout"}.issubset(events)
        assert len(db.scalars(select(RevokedToken)).all()) == 1


def test_login_rate_limit_and_failed_login_audit(client_and_session):
    client, Session = client_and_session
    headers = {"Origin": ORIGIN}
    for _ in range(5):
        response = client.post(
            "/api/auth/login",
            json={"email": "missing@example.com", "password": "wrong-password"},
            headers=headers,
        )
        assert response.status_code == 401
    limited = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "wrong-password"},
        headers=headers,
    )
    assert limited.status_code == 429
    assert limited.headers.get("retry-after") == "900"
    with Session() as db:
        assert len(db.scalars(select(LoginAttempt)).all()) == 5
        event_types = [x.event_type for x in db.scalars(select(SecurityEvent)).all()]
        assert "login_failed" in event_types
        assert "login_rate_limited" in event_types


def test_password_change_revokes_existing_sessions(client_and_session):
    client, Session = client_and_session
    headers = {"Origin": ORIGIN}
    client.post(
        "/api/auth/register",
        json={"email": "rotate@example.com", "password": "Old-password-2026!", "display_name": "Rotate"},
        headers=headers,
    )
    assert client.post(
        "/api/auth/login",
        json={"email": "rotate@example.com", "password": "Old-password-2026!"},
        headers=headers,
    ).status_code == 200
    csrf = client.cookies.get("finova_csrf")
    changed = client.patch(
        "/api/profile/password",
        json={"current_password": "Old-password-2026!", "new_password": "New-password-2026!"},
        headers={**headers, "X-CSRF-Token": csrf},
    )
    assert changed.status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    assert client.post(
        "/api/auth/login",
        json={"email": "rotate@example.com", "password": "New-password-2026!"},
        headers=headers,
    ).status_code == 200
    with Session() as db:
        user = db.scalar(select(User).where(User.email == "rotate@example.com"))
        assert user.token_version == 1


def test_react_frontend_escapes_output_and_sets_csp():
    root = Path(__file__).resolve().parents[2]
    frontend = root / "Frontend"
    html = (frontend / "index.html").read_text(encoding="utf-8")

    # React به‌صورت پیش‌فرض مقادیر متغیرها را escape می‌کند؛ هیچ HTML خامی تزریق نمی‌شود.
    source_files = [p for p in (frontend / "src").rglob("*") if p.suffix in {".js", ".jsx"}]
    assert source_files, "منبع فرانت‌اند React پیدا نشد."
    source = "\n".join(p.read_text(encoding="utf-8") for p in source_files)
    assert "dangerouslySetInnerHTML" not in source
    assert "innerHTML" not in source

    # نشست فقط در Cookie HttpOnly نگه داشته می‌شود؛ نه در حافظه مرورگر و نه در هدر Authorization.
    # تنها استفاده مجاز از localStorage ذخیرهٔ سلیقهٔ ظاهری (تم روشن/تاریک) است و
    # هیچ توکن یا داده‌ای از حساب کاربر در آن نوشته نمی‌شود.
    for path in source_files:
        text = path.read_text(encoding="utf-8")
        if "localStorage" in text or "sessionStorage" in text:
            relative = path.relative_to(frontend).as_posix()
            assert relative == "src/lib/theme.js", f"استفاده غیرمنتظره از حافظه مرورگر در {relative}"
            assert "finova:theme" in text
    for forbidden in ("access_token", "refresh_token", "Bearer ", "Authorization"):
        assert forbidden not in source, f"یافتن «{forbidden}» در کد فرانت‌اند مجاز نیست."

    # سیاست امنیتی محتوا مطابق نسخه قبلی و بدون اجرای اسکریپت درون‌خطی/eval.
    assert "Content-Security-Policy" in html
    assert "object-src 'none'" in html
    assert "unsafe-eval" not in html
    assert "script-src 'self'" in html and "script-src 'self' 'unsafe-inline'" not in html

    api_client = (frontend / "src/api/client.js").read_text(encoding="utf-8")
    assert "X-CSRF-Token" in api_client
    assert "credentials: 'include'" in api_client


def test_untrusted_origin_is_rejected(client_and_session):
    client, _Session = client_and_session
    response = client.post(
        "/api/auth/login",
        json={"email": "someone@example.com", "password": "wrong-password"},
        headers={"Origin": "https://attacker.invalid"},
    )
    assert response.status_code == 403


def test_rotating_signing_secret_invalidates_previous_jwts(monkeypatch):
    old_secret = security.SECRET_KEY
    token, _jti, _expires = create_access_token(123, 0)
    assert decode_access_token(token) is not None
    monkeypatch.setattr(security, "SECRET_KEY", old_secret + "-rotated")
    assert decode_access_token(token) is None


def test_no_common_provider_api_key_patterns_are_committed():
    import re
    root = Path(__file__).resolve().parents[2]
    patterns = [
        re.compile(r"AIza[0-9A-Za-z_-]{30,}"),
        re.compile(r"sk-[A-Za-z0-9]{20,}"),
        re.compile(r"ghp_[A-Za-z0-9]{20,}"),
        re.compile(r"AKIA[0-9A-Z]{16}"),
    ]
    ignored = {"requirements-lock.txt", "SECURITY.md"}
    for path in root.rglob("*"):
        if not path.is_file() or ".git" in path.parts or "__pycache__" in path.parts or ".pytest_cache" in path.parts:
            continue
        if path.name in ignored or path.name == ".env.example":
            continue
        content = path.read_text(encoding="utf-8", errors="ignore")
        assert not any(pattern.search(content) for pattern in patterns), f"Possible embedded secret in {path.relative_to(root)}"
