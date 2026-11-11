"""Application configuration loaded via pydantic-settings."""

import json

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Linklet system settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Core Environment
    environment: str = Field(default="development")
    debug: bool = Field(default=False)

    # Public Addressing
    public_short_base_url: str = Field(
        default="http://localhost:8000",
        description="Public base URL for generated short links (e.g. https://linklet.onrender.com)",
    )
    allowed_cors_origins: str | list[str] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "https://linklet-six.vercel.app",
        ]
    )

    @field_validator("allowed_cors_origins", mode="after")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v == "*":
                return ["*"]
            if v.startswith("[") and v.endswith("]"):
                try:
                    parsed = json.loads(v)
                    if isinstance(parsed, list):
                        return [str(origin).strip() for origin in parsed if str(origin).strip()]
                except Exception:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        if isinstance(v, list):
            return [str(origin).strip() for origin in v if str(origin).strip()]
        return ["*"]


    # PostgreSQL Database
    database_url: str = Field(
        default="postgresql+asyncpg://linklet:local-only-change-me@localhost:5433/linklet",
        description="SQLAlchemy async PostgreSQL connection string",
    )
    direct_database_url: str | None = Field(
        default=None,
        description="Direct unpooled PostgreSQL connection string for Alembic DDL migrations",
    )
    db_pool_size: int = Field(default=10)
    db_max_overflow: int = Field(default=5)
    db_pool_timeout: float = Field(default=5.0)
    db_pool_recycle: int = Field(default=300)
    db_echo: bool = Field(default=False)

    # Redis Cache & Rate Limiting
    redis_url: str = Field(default="redis://localhost:6379/0")
    redis_max_connections: int = Field(default=50)
    cache_default_ttl_seconds: int = Field(
        default=900, description="Default TTL for active non-expiring short links (15 minutes)"
    )
    cache_negative_ttl_seconds: int = Field(
        default=60, description="TTL for negative cache entries when URL is not found (1 minute)"
    )
    cache_tombstone_ttl_seconds: int = Field(
        default=3600, description="TTL for deleted or expired URL tombstones (1 hour)"
    )

    # RabbitMQ Messaging
    amqp_url: str = Field(default="amqp://guest:guest@localhost:5672/")
    amqp_exchange: str = Field(default="analytics.events")
    amqp_routing_key: str = Field(default="url.click")
    amqp_queue: str = Field(default="url.clicks.v1")
    amqp_prefetch: int = Field(default=50)
    run_click_consumer: bool = Field(
        default=False,
        description="When true, run background click consumer task inside the API process",
    )
    run_outbox_worker: bool = Field(
        default=True,
        description="When true, run background transactional outbox relay worker",
    )
    outbox_poll_interval_seconds: float = Field(
        default=1.0,
        description="Polling interval in seconds for transactional outbox dispatch",
    )

    # Rate Limiting Policies
    rate_limit_create_window_seconds: int = Field(default=60)
    rate_limit_create_max_requests: int = Field(default=60)
    rate_limit_redirect_window_seconds: int = Field(default=60)
    rate_limit_redirect_max_requests: int = Field(default=600)

    # Google OAuth 2.0 Identity
    google_client_id: str | None = Field(
        default=None,
        description="Google OAuth Client ID for identity verification",
    )
    google_client_secret: str | None = Field(
        default=None,
        description="Google OAuth Client Secret",
    )

    # Reserved Short Aliases
    reserved_aliases: set[str] = Field(
        default={
            "api",
            "health",
            "ready",
            "docs",
            "redoc",
            "openapi.json",
            "favicon.ico",
            "robots.txt",
            "static",
            "assets",
            "admin",
            "login",
            "signup",
            "dashboard",
        }
    )


settings = Settings()

