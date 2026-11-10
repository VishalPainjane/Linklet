"""Linklet domain exceptions with exact HTTP status mapping."""

from typing import Any


class LinkletError(Exception):
    """Base domain exception for Linklet."""

    def __init__(self, message: str, status_code: int = 500, details: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class UrlNotFoundError(LinkletError):
    """Raised when a short code is not found in storage."""

    def __init__(self, code: str) -> None:
        super().__init__(f"Short URL '{code}' not found.", status_code=404)
        self.code = code


class UrlGoneError(LinkletError):
    """Raised when a short URL has expired or been disabled (HTTP 410)."""

    def __init__(self, code: str, reason: str = "expired or disabled") -> None:
        super().__init__(f"Short URL '{code}' is {reason}.", status_code=410)
        self.code = code
        self.reason = reason


class AliasAlreadyTakenError(LinkletError):
    """Raised when a custom alias is already claimed by another URL (HTTP 409)."""

    def __init__(self, alias: str) -> None:
        super().__init__(f"Custom alias '{alias}' is already in use.", status_code=409)
        self.alias = alias


class IdempotencyConflictError(LinkletError):
    """Raised when an idempotency key is reused with a different request payload (HTTP 409)."""

    def __init__(self, key: str) -> None:
        super().__init__(
            f"Idempotency key '{key}' was previously used with a different request payload.",
            status_code=409,
        )
        self.key = key


class InvalidUrlError(LinkletError):
    """Raised when a destination URL fails validation (HTTP 422)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason, status_code=422)


class InvalidAliasError(LinkletError):
    """Raised when a custom alias violates naming/reserved constraints (HTTP 422)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason, status_code=422)


class RateLimitExceededError(LinkletError):
    """Raised when client exceeds rate limit quotas (HTTP 429)."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            f"Rate limit exceeded. Try again in {retry_after} seconds.",
            status_code=429,
            details={"retry_after": retry_after},
        )
        self.retry_after = retry_after


class DependencyUnavailableError(LinkletError):
    """Raised when a required backing service (PostgreSQL, Redis) is unreachable (HTTP 503)."""

    def __init__(self, service_name: str) -> None:
        super().__init__(
            f"Required backing service '{service_name}' is unavailable.", status_code=503
        )
        self.service_name = service_name
