"""Unit tests for standard JWT authentication utilities."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest

from linklet.api.routes.auth import create_access_token, hash_password, verify_password
from linklet.config import settings


def test_password_hashing_and_verification() -> None:
    password = "SuperSecretPassword123!"
    hashed = hash_password(password)

    assert hashed != password
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword", hashed) is False


def test_jwt_create_and_decode() -> None:
    user_id = uuid4()
    email = "user@example.com"
    token = create_access_token(user_id=user_id, email=email)

    assert isinstance(token, str)
    assert len(token.split(".")) == 3

    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )
    assert payload["sub"] == str(user_id)
    assert payload["email"] == email
    assert "exp" in payload
    assert "iat" in payload


def test_jwt_expired_token() -> None:
    user_id = uuid4()
    # Create expired token manually
    now = datetime.now(UTC) - timedelta(hours=2)
    payload = {
        "sub": str(user_id),
        "email": "user@example.com",
        "iat": int((now - timedelta(minutes=10)).timestamp()),
        "exp": int(now.timestamp()),
    }
    expired_token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    with pytest.raises(jwt.ExpiredSignatureError):
        jwt.decode(
            expired_token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )

