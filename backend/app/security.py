import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
from dotenv import load_dotenv
from pwdlib import PasswordHash

load_dotenv()

password_hasher = PasswordHash.recommended()
ENVIRONMENT = os.getenv("FINOVA_ENV", "development").strip().lower()
SECRET_KEY = (os.getenv("FINOVA_SECRET_KEY") or os.getenv("DARIK_SECRET_KEY") or "").strip()
if not SECRET_KEY:
    if ENVIRONMENT == "production":
        raise RuntimeError("FINOVA_SECRET_KEY must be set to a random secret of at least 32 characters in production.")
    # Random local-only key: server restarts invalidate development sessions.
    SECRET_KEY = secrets.token_urlsafe(48)
    logging.warning("FINOVA_SECRET_KEY is unset; using a temporary random development key. Set a persistent secret before deployment.")
if ENVIRONMENT == "production" and len(SECRET_KEY) < 32:
    raise RuntimeError("FINOVA_SECRET_KEY must contain at least 32 characters in production.")

ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60
SESSION_COOKIE_NAME = "finova_session"
CSRF_COOKIE_NAME = "finova_csrf"
COOKIE_SECURE = ENVIRONMENT == "production" or os.getenv("FINOVA_COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = "lax"

def hash_password(password: str) -> str:
    return password_hasher.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)

def create_access_token(user_id: int, token_version: int = 0) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    jti = str(uuid4())
    payload = {"sub": str(user_id), "ver": token_version, "jti": jti, "iat": now, "exp": expires}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM), jti, expires

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        subject = payload.get("sub")
        jti = payload.get("jti")
        version = payload.get("ver")
        if not subject or not jti or not isinstance(version, int):
            return None
        return {"user_id": int(subject), "jti": str(jti), "version": version, "exp": int(payload["exp"])}
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        return None

def keyed_hash(value: str) -> str:
    return hmac.new(SECRET_KEY.encode(), value.encode("utf-8", "ignore"), hashlib.sha256).hexdigest()

def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)
