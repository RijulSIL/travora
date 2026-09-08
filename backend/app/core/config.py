from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    db_host: str = "localhost"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "trp"
    db_create_if_missing: bool = True

    admin_email: str = "admin@local"
    admin_password: str = "ChangeMe!123"
    admin_full_name: str = "System Administrator"

    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    reset_password_token_expire_hours: int = 1
    otp_expire_minutes: int = 10
    trusted_device_expire_days: int = 30
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: str = "lax"
    encryption_key: str | None = None
    cors_origins: str | list[str] = "http://localhost:3000"

    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    invoice_storage_dir: str = "storage/invoices"
    travel_ticket_storage_dir: str = "storage/travel_tickets"
    travel_request_min_lead_working_days: int = 2
    # Optional GSTN live validation.
    gstn_public_api_base: str | None = None
    gstn_http_timeout_seconds: float = 8.0

    # Optional: Gemini Developer API for invoice extraction (see invoice upload pipeline).
    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    )
    gemini_invoice_model_primary: str = "gemini-2.5-flash"
    gemini_invoice_model_fallback: str = "gemini-2.0-flash"

    # Transactional Email Notification System (SMTP)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@trp.sil.com"

    api_v1_prefix: str = "/api/v1"

    @property
    def database_url(self) -> str:
        encoded_password = quote_plus(self.db_password)
        return (
            f"mysql+aiomysql://{self.db_user}:{encoded_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("refresh_cookie_samesite")
    @classmethod
    def validate_refresh_cookie_samesite(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("refresh_cookie_samesite must be one of: lax, strict, none")
        return normalized


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
