"""Pydantic v2 schemas for user authentication and session management."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    """Credentials payload for user sign in."""

    email: str = Field(..., max_length=255, description="User email address")
    password: str = Field(..., min_length=6, max_length=128, description="Account password")


class RegisterRequest(BaseModel):
    """Credentials payload for new user registration."""

    email: str = Field(..., max_length=255, description="User email address")
    password: str = Field(..., min_length=6, max_length=128, description="Account password")



class GoogleAuthRequest(BaseModel):
    """Google OAuth credential verification payload."""

    credential: str = Field(
        ..., description="Google ID Token JWT returned from Google Identity Services"
    )




class UserResponse(BaseModel):
    """User account entity response."""

    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    email: str | None
    created_at: datetime


class AuthResponse(BaseModel):
    """Session authentication payload returned upon sign-in."""

    token: str
    user: UserResponse

