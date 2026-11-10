"""Application configuration loaded via pydantic-settings."""

from pydantic import Field
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
    allowed_cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"]
    )

    # PostgreSQL Database
    database_url: str = Field(
        default="postgresql+asyncpg://linklet:local-only-change-me@localhost:5432/linklet",
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

    # Rate Limiting Policies
    rate_limit_create_window_seconds: int = Field(default=60)
    rate_limit_create_max_requests: int = Field(default=60)
    rate_limit_redirect_window_seconds: int = Field(default=60)
    rate_limit_redirect_max_requests: int = Field(default=600)

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
