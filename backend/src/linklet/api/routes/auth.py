"""Standard stateless JWT authentication routes."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import get_current_user, get_session
from linklet.config import settings
from linklet.models.user import User
from linklet.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    UserResponse,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def hash_password(password: str) -> str:
    """Hash password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against bcrypt hash."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(
    user_id: UUID | str,
    email: str | None,
    created_at: datetime | str | None = None,
) -> str:
    """Create a standard signed JWT access token."""
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if created_at is not None:
        payload["created_at"] = (
            created_at.isoformat() if isinstance(created_at, datetime) else str(created_at)
        )
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    """Register a new user account with email and password."""
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Valid email required.",
        )
    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 6 characters.",
        )

    # Check if user already exists
    result = await session.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists. Please sign in.",
        )

    user = User(email=email, password_hash=hash_password(payload.password))
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token = create_access_token(user_id=user.id, email=user.email, created_at=user.created_at)

    return AuthResponse(
        token=token,
        token_type="bearer",
        user=UserResponse(id=user.id, email=user.email, created_at=user.created_at),
    )


@router.post("/login", response_model=AuthResponse, status_code=status.HTTP_200_OK)
async def login(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    """Sign in an existing user with email and password."""
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Valid email required.",
        )

    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if (
        not user
        or not user.password_hash
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_access_token(user_id=user.id, email=user.email, created_at=user.created_at)

    return AuthResponse(
        token=token,
        token_type="bearer",
        user=UserResponse(id=user.id, email=user.email, created_at=user.created_at),
    )


@router.get("/me", response_model=UserResponse, status_code=status.HTTP_200_OK)
async def get_current_user_profile(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> UserResponse:
    """Retrieve currently active user profile from JWT."""
    created_at_val = current_user.get("created_at")
    if created_at_val:
        try:
            created_at_dt = datetime.fromisoformat(created_at_val)
        except Exception:
            created_at_dt = datetime.now(UTC)
    else:
        created_at_dt = datetime.now(UTC)

    return UserResponse(
        id=UUID(current_user["id"]),
        email=current_user.get("email"),
        created_at=created_at_dt,
    )


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout() -> dict[str, str]:
    """Logout endpoint (JWT is stateless, discard token on client)."""
    return {"message": "Logged out successfully"}
