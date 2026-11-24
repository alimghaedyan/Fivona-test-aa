import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select, func
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, DbSession
from app.models import LoginAttempt, Profile, RevokedToken, User
from app.schema import LoginRequest, RegisterRequest, UserResponse
from app.security import (
    ACCESS_TOKEN_MINUTES, COOKIE_SAMESITE, COOKIE_SECURE, CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME, create_access_token, decode_access_token, hash_password,
    keyed_hash, new_csrf_token, verify_password,
)
from app.security_events import record_security_event

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LOGIN_WINDOW_MINUTES = 15
LOGIN_IP_LIMIT = 10
LOGIN_EMAIL_LIMIT = 5
DUMMY_PASSWORD_HASH = hash_password("not-a-real-user-password-for-timing-equalization")

def normalize_email(email: str) -> str:
    return email.strip().lower()

def valid_email(email: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email))

def make_user_response(user: User) -> UserResponse:
    return UserResponse(id=user.id, email=user.email, display_name=user.profile.display_name if user.profile else "")

def set_session_cookies(response: Response, token: str, csrf: str) -> None:
    common = {"max_age": ACCESS_TOKEN_MINUTES * 60, "path": "/", "secure": COOKIE_SECURE, "samesite": COOKIE_SAMESITE}
    response.set_cookie(SESSION_COOKIE_NAME, token, httponly=True, **common)
    response.set_cookie(CSRF_COOKIE_NAME, csrf, httponly=False, **common)

def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=COOKIE_SECURE, httponly=True, samesite=COOKIE_SAMESITE)
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", secure=COOKIE_SECURE, httponly=False, samesite=COOKIE_SAMESITE)

def enforce_login_limit(db: Session, request: Request, email: str) -> tuple[str, str]:
    ip = request.client.host if request.client else "unknown"
    ip_hash, email_hash = keyed_hash(ip), keyed_hash(email)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=LOGIN_WINDOW_MINUTES)
    db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at < now - timedelta(days=1)))
    count_ip = db.scalar(select(func.count(LoginAttempt.id)).where(LoginAttempt.ip_hash == ip_hash, LoginAttempt.attempted_at >= cutoff)) or 0
    count_email = db.scalar(select(func.count(LoginAttempt.id)).where(LoginAttempt.email_hash == email_hash, LoginAttempt.attempted_at >= cutoff)) or 0
    if count_ip >= LOGIN_IP_LIMIT or count_email >= LOGIN_EMAIL_LIMIT:
        record_security_event(db, request, "login_rate_limited", email=email)
        db.commit()
        raise HTTPException(status_code=429, detail="تعداد تلاش‌های ورود بیش از حد مجاز است. ۱۵ دقیقه دیگر دوباره تلاش کنید.", headers={"Retry-After": "900"})
    return ip_hash, email_hash

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, request: Request, db: DbSession):
    email = normalize_email(data.email)
    if not valid_email(email):
        raise HTTPException(status_code=422, detail="لطفاً یک ایمیل معتبر وارد کنید.")
    if not data.display_name.strip():
        raise HTTPException(status_code=422, detail="نام نمایشی نمی‌تواند خالی باشد.")
    if db.scalar(select(User).where(User.email == email)):
        record_security_event(db, request, "registration_duplicate_email", email=email)
        db.commit()
        raise HTTPException(status_code=409, detail="این ایمیل قبلاً ثبت‌نام کرده است.")
    user = User(email=email, password_hash=hash_password(data.password))
    try:
        db.add(user); db.flush()
        db.add(Profile(user_id=user.id, display_name=data.display_name.strip()))
        db.commit(); db.refresh(user)
        record_security_event(db, request, "registration_success", user_id=user.id, email=email)
        db.commit()
    except Exception:
        db.rollback(); raise
    return make_user_response(user)

@router.post("/login")
def login(data: LoginRequest, request: Request, response: Response, db: DbSession):
    email = normalize_email(data.email)
    ip_hash, email_hash = enforce_login_limit(db, request, email)
    user = db.scalar(select(User).where(User.email == email))
    valid = verify_password(data.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not valid:
        db.add(LoginAttempt(email_hash=email_hash, ip_hash=ip_hash))
        record_security_event(db, request, "login_failed", email=email)
        db.commit()
        raise HTTPException(status_code=401, detail="ایمیل یا رمز عبور اشتباه است.")
    db.execute(delete(LoginAttempt).where(LoginAttempt.email_hash == email_hash, LoginAttempt.ip_hash == ip_hash))
    record_security_event(db, request, "login_success", user_id=user.id, email=email)
    db.commit()
    token, _jti, _expires = create_access_token(user.id, user.token_version)
    csrf = new_csrf_token()
    set_session_cookies(response, token, csrf)
    return {"authenticated": True, "token_type": "cookie"}

@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    claims = decode_access_token(token) if token else None
    if claims:
        if db.get(RevokedToken, claims["jti"]) is None:
            db.add(RevokedToken(jti=claims["jti"], expires_at=datetime.fromtimestamp(claims["exp"], timezone.utc)))
        record_security_event(db, request, "logout", user_id=claims["user_id"])
        db.commit()
    clear_session_cookies(response)
    response.status_code = 204
    return response

@router.get("/me", response_model=UserResponse)
def get_me(user: CurrentUser):
    return make_user_response(user)
