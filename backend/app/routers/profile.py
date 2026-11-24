import json

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentUser, DbSession
from app.models import Profile, User
from app.schema import (
    ChangePasswordRequest,
    ProfileResponse,
    ProfileUpdate,
)
from app.security import hash_password, verify_password
from app.security_events import record_security_event
from fastapi import Request, Response
from app.routers.auth import clear_session_cookies


router = APIRouter(
    prefix="/api/profile",
    tags=["Profile"],
)


def get_or_create_profile(db: DbSession, user: User) -> Profile:
    profile = db.scalar(
        select(Profile).where(Profile.user_id == user.id)
    )

    if profile is None:
        profile = Profile(
            user_id=user.id,
            display_name="",
            preferences="{}",
        )
        db.add(profile)
        db.flush()

    return profile


def make_profile_response(
    user: User,
    profile: Profile,
) -> ProfileResponse:
    try:
        preferences = json.loads(profile.preferences or "{}")
    except (json.JSONDecodeError, TypeError):
        preferences = {}

    if not isinstance(preferences, dict):
        preferences = {}

    return ProfileResponse(
        id=user.id,
        email=user.email,
        display_name=profile.display_name,
        preferences=preferences,
    )


@router.get("/", response_model=ProfileResponse)
def get_profile(
    db: DbSession,
    current_user: CurrentUser,
):
    profile = get_or_create_profile(db, current_user)
    db.commit()

    return make_profile_response(current_user, profile)


@router.patch("/", response_model=ProfileResponse)
def update_profile(
    data: ProfileUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    updates = data.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="حداقل یک فیلد برای ویرایش ارسال کنید.",
        )

    profile = get_or_create_profile(db, current_user)

    if "display_name" in updates:
        display_name = updates["display_name"]

        if display_name is None or not display_name.strip():
            raise HTTPException(
                status_code=422,
                detail="نام نمایشی نمی‌تواند خالی باشد.",
            )

        profile.display_name = display_name.strip()

    if "preferences" in updates:
        preferences = updates["preferences"]

        if preferences is None:
            raise HTTPException(
                status_code=422,
                detail="تنظیمات باید به‌صورت یک شیء JSON ارسال شوند.",
            )

        profile.preferences = json.dumps(
            preferences,
            ensure_ascii=False,
        )

    db.commit()
    db.refresh(profile)

    return make_profile_response(current_user, profile)


@router.patch("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: ChangePasswordRequest,
    request: Request,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
):
    user = db.scalar(
        select(User).where(User.id == current_user.id)
    )

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="کاربر پیدا نشد.",
        )

    if not verify_password(
        data.current_password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="رمز عبور فعلی صحیح نیست.",
        )

    if data.current_password == data.new_password:
        raise HTTPException(
            status_code=422,
            detail="رمز عبور جدید باید با رمز فعلی متفاوت باشد.",
        )

    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    record_security_event(db, request, "password_changed_all_sessions_revoked", user_id=user.id, email=user.email)
    db.commit()
    clear_session_cookies(response)

    return None