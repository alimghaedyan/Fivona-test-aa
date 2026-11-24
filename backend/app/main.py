import hmac
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app import models
from app.database import Base, engine, run_security_migrations
from app.routers.auth import router as auth_router
from app.routers.transactions import router as transaction_router
from app.routers.categories import router as categories_router
from app.routers.budgets import router as budgets_router
from app.routers.dashboard import router as dashboard_router
from app.routers.financial_health import router as financial_health_router
from app.routers.reports import router as reports_router
from app.routers.profile import router as profile_router
from app.routers.analytics import router as analytics_router
from app.security import CSRF_COOKIE_NAME, SESSION_COOKIE_NAME

ALLOWED_ORIGINS = [x.strip() for x in os.getenv("FINOVA_ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:8000,http://localhost:8000").split(",") if x.strip()]

class SecurityHeadersAndCSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin and origin not in ALLOWED_ORIGINS:
                logging.getLogger("finova.security").warning("request_rejected_untrusted_origin", extra={"path": request.url.path})
                return JSONResponse({"detail": "درخواست از مبدأ غیرمجاز رد شد."}, status_code=403)
            if request.cookies.get(SESSION_COOKIE_NAME) and request.url.path not in {"/api/auth/login", "/api/auth/register"}:
                csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
                csrf_header = request.headers.get("x-csrf-token", "")
                if not csrf_cookie or not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
                    logging.getLogger("finova.security").warning("request_rejected_csrf_validation", extra={"path": request.url.path})
                    return JSONResponse({"detail": "اعتبارسنجی CSRF ناموفق بود."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/auth") else "no-cache"
        return response

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_security_migrations()
    yield

app = FastAPI(title="Finova API", description="Backend for the Finova personal finance application", version="0.3.0", lifespan=lifespan)
app.add_middleware(SecurityHeadersAndCSRFMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"])

app.include_router(auth_router)
app.include_router(transaction_router)
app.include_router(categories_router)
app.include_router(budgets_router)
app.include_router(dashboard_router)
app.include_router(financial_health_router)
app.include_router(reports_router)
app.include_router(profile_router)
app.include_router(analytics_router)

@app.get("/")
def root():
    return {"app": "Finova", "message": "Finova API is running"}

@app.get("/api/health")
def health():
    return {"status": "ok", "database": "configured"}
