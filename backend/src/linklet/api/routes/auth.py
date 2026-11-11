"""Authentication and user session routes."""

import json
import secrets
from typing import Any
from uuid import UUID

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import get_current_user, get_session
from linklet.config import settings
from linklet.models.user import User
from linklet.schemas.auth import (
    AuthResponse,
    GoogleAuthRequest,
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


@router.post("/login", response_model=AuthResponse, status_code=status.HTTP_200_OK)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
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

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    # Verify password if user has password_hash
    if user.password_hash:
        if not verify_password(payload.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )
    else:
        # Legacy user logging in with password for the first time
        user.password_hash = hash_password(payload.password)
        await session.commit()

    token = f"lkt_sess_{secrets.token_hex(24)}"
    session_data = {
        "id": str(user.id),
        "email": user.email,
        "created_at": user.created_at.isoformat(),
    }

    redis_client = getattr(request.app.state, "redis", None)
    if redis_client:
        await redis_client.set(f"session:{token}", json.dumps(session_data), ex=7 * 86400)
    else:
        if not hasattr(request.app.state, "sessions"):
            request.app.state.sessions = {}
        request.app.state.sessions[f"session:{token}"] = json.dumps(session_data)

    response.set_cookie(
        key="linklet_session",
        value=token,
        max_age=7 * 86400,
        httponly=True,
        samesite="lax",
        secure=False,
    )

    return AuthResponse(
        token=token,
        user=UserResponse(id=user.id, email=user.email, created_at=user.created_at),
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
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

    token = f"lkt_sess_{secrets.token_hex(24)}"
    session_data = {
        "id": str(user.id),
        "email": user.email,
        "created_at": user.created_at.isoformat(),
    }

    redis_client = getattr(request.app.state, "redis", None)
    if redis_client:
        await redis_client.set(f"session:{token}", json.dumps(session_data), ex=7 * 86400)
    else:
        if not hasattr(request.app.state, "sessions"):
            request.app.state.sessions = {}
        request.app.state.sessions[f"session:{token}"] = json.dumps(session_data)

    response.set_cookie(
        key="linklet_session",
        value=token,
        max_age=7 * 86400,
        httponly=True,
        samesite="lax",
        secure=False,
    )

    return AuthResponse(
        token=token,
        user=UserResponse(id=user.id, email=user.email, created_at=user.created_at),
    )




@router.post("/google", response_model=AuthResponse, status_code=status.HTTP_200_OK)
async def login_with_google(
    payload: GoogleAuthRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    """Verify Google OAuth credential ID token and establish session."""
    token_str = payload.credential.strip()
    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Credential token is required.",
        )

    # In local testing/dev, support test token prefix
    if settings.environment == "development" and token_str.startswith("dev_test_"):
        mock_email = token_str.replace("dev_test_", "").strip().lower()
        id_info: dict[str, Any] = {"email": mock_email, "name": "Google Test User"}
    else:
        try:
            client_id = settings.google_client_id
            id_info = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
                token_str,
                google_requests.Request(),
                audience=client_id if client_id else None,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid Google authentication token: {exc}",
            ) from exc

    raw_email = id_info.get("email")
    if not raw_email or not isinstance(raw_email, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account does not have an associated email address.",
        )
    email: str = raw_email.strip().lower()

    # 1. Upsert / Fetch user in PostgreSQL
    stmt = (
        pg_insert(User)
        .values(email=email)
        .on_conflict_do_update(
            index_elements=[User.email],
            set_={"email": email},
        )
        .returning(User)
    )
    res = await session.execute(stmt)
    await session.commit()
    user = res.scalar_one()

    # 2. Issue cryptographically secure 192-bit session token
    token = f"lkt_sess_{secrets.token_hex(24)}"
    session_data = {
        "id": str(user.id),
        "email": user.email,
        "name": id_info.get("name"),
        "picture": id_info.get("picture"),
        "created_at": user.created_at.isoformat(),
    }

    # 3. Store session in Redis with 7-day TTL (or in-memory store)
    redis_client = getattr(request.app.state, "redis", None)
    if redis_client:
        await redis_client.set(f"session:{token}", json.dumps(session_data), ex=7 * 86400)
    else:
        if not hasattr(request.app.state, "sessions"):
            request.app.state.sessions = {}
        request.app.state.sessions[f"session:{token}"] = json.dumps(session_data)

    # 4. Set HttpOnly Cookie for automatic browser session management
    response.set_cookie(
        key="linklet_session",
        value=token,
        max_age=7 * 86400,
        httponly=True,
        samesite="lax",
        secure=False,
    )

    return AuthResponse(
        token=token,
        user=UserResponse(id=user.id, email=user.email, created_at=user.created_at),
    )


@router.get("/me", response_model=UserResponse, status_code=status.HTTP_200_OK)
async def get_current_user_profile(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> UserResponse:
    """Retrieve currently active user session profile."""
    return UserResponse(
        id=UUID(current_user["id"]),
        email=current_user.get("email"),
        created_at=current_user["created_at"],
    )


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(
    request: Request,
    response: Response,
) -> dict[str, str]:
    """Revoke session token from Redis and clear session cookie."""
    auth_header = request.headers.get("Authorization")
    token: str | None = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "linklet_session" in request.cookies:
        token = request.cookies.get("linklet_session")

    if token:
        redis_client = getattr(request.app.state, "redis", None)
        if redis_client:
            await redis_client.delete(f"session:{token}")
        in_memory_sessions = getattr(request.app.state, "sessions", None)
        if in_memory_sessions and f"session:{token}" in in_memory_sessions:
            del in_memory_sessions[f"session:{token}"]

    response.delete_cookie("linklet_session")
    return {"message": "Logged out successfully"}
