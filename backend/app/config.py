"""Backend settings, read from environment variables (MEDBASE_*)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MEDBASE_")

    # Default matches the database from docker-compose.yml when the backend runs on the host.
    # medbase_api has no data access of its own: every request switches to the user's role.
    database_url: str = "postgresql://medbase_api:medbase_api@127.0.0.1:55440/hospital_ward"
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    # Signs the session cookie. The default is for local development only.
    session_secret: str = "dev-only-session-secret-change-me"
    # One shift; after that the user has to log in again
    session_max_age_seconds: int = 12 * 60 * 60
    # True behind HTTPS: the cookie is then never sent over plain HTTP
    session_https_only: bool = False

    # Brute-force protection for 4-digit PINs
    login_max_failures: int = 5
    login_lockout_seconds: int = 5 * 60

    # Background escalation of overdue HIGH/CRITICAL alerts (UC-7)
    escalation_enabled: bool = True
    escalation_interval_seconds: float = 2.0

    # Device simulator for demos: stands in for patient monitors and call buttons.
    # Turn off for any real installation.
    simulator_enabled: bool = True


settings = Settings()
