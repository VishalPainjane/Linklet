"""Unit tests for Pydantic schema input validation."""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from linklet.schemas.url import CreateUrlRequest


def test_valid_creation_request() -> None:
    req = CreateUrlRequest(url="https://example.com/system-lab")
    assert req.url == "https://example.com/system-lab"
    assert req.custom_alias is None
    assert req.expires_at is None


def test_valid_custom_alias_and_camel_case() -> None:
    req = CreateUrlRequest.model_validate(
        {"url": "https://example.com", "customAlias": "custom-link_01"}
    )
    assert req.custom_alias == "custom-link_01"


def test_rejects_invalid_scheme() -> None:
    with pytest.raises(ValidationError, match="Destination URL must use http or https scheme"):
        CreateUrlRequest(url="javascript:alert(1)")

    with pytest.raises(ValidationError, match="Destination URL must use http or https scheme"):
        CreateUrlRequest(url="ftp://files.example.com/doc")


def test_rejects_empty_url() -> None:
    with pytest.raises(ValidationError, match="Destination URL cannot be empty"):
        CreateUrlRequest(url="   ")


def test_rejects_reserved_alias() -> None:
    for reserved in ["api", "health", "ready", "docs", "robots.txt"]:
        with pytest.raises(ValidationError, match="reserved path"):
            CreateUrlRequest(url="https://example.com", custom_alias=reserved)


def test_rejects_invalid_alias_characters() -> None:
    invalid_aliases = ["has spaces", "bad@char", "slash/not/allowed", "a", "toolong" * 6]
    for alias in invalid_aliases:
        with pytest.raises(ValidationError):
            CreateUrlRequest(url="https://example.com", custom_alias=alias)


def test_expiration_validation() -> None:
    future = datetime.now(UTC) + timedelta(hours=1)
    req = CreateUrlRequest(url="https://example.com", expires_at=future)
    assert req.expires_at == future

    past = datetime.now(UTC) - timedelta(hours=1)
    with pytest.raises(ValidationError, match="Expiration time must be strictly in the future"):
        CreateUrlRequest(url="https://example.com", expires_at=past)
