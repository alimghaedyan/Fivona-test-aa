from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RevokedToken, User
from app.security import SESSION_COOKIE_NAME, decode_access_token

DbSession = Annotated[Session, Depends(get_db)]

def get_current_user(request: Request, db: DbSession) -> User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    claims = decode_access_token(token) if token else None
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="نشست نامعتبر یا منقضی شده است.", headers={"WWW-Authenticate": "Bearer"})
    if db.get(RevokedToken, claims["jti"]) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="این نشست باطل شده است.")
    user = db.get(User, claims["user_id"])
    if user is None or user.token_version != claims["version"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="نشست نامعتبر یا منقضی شده است.")
    return user

CurrentUser = Annotated[User, Depends(get_current_user)]
