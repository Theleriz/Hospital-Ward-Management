"""Backend settings, read from environment variables (MEDBASE_*)."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


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
    login_max_failures: int = Field(default=5, ge=1, le=1000)
    login_lockout_seconds: int = Field(default=5 * 60, ge=1, le=86400)

    # DEMO ONLY: the badge alone logs in, no PIN (decisions.md, record 16). A photo of
    # a badge barcode is then enough to log in, so never turn this on for real use.
    demo_badge_login: bool = False

    # Background escalation of overdue HIGH/CRITICAL alerts (UC-7)
    escalation_enabled: bool = True
    escalation_interval_seconds: float = 2.0

    # Device simulator for demos: stands in for patient monitors and call buttons.
    # Turn off for any real installation.
    simulator_enabled: bool = True

    # Corridor board (part 4): no login, so access is limited by where the request comes from.
    # Comma-separated networks that may open the board: loopback and private ranges by default.
    board_allowed_networks: str = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    # Comma-separated secret tokens of known screens outside those networks (sent as
    # X-Board-Screen); empty means none. Use long random values.
    board_screen_tokens: str = ""
    # Proxies whose X-Real-IP header is believed (the board's nginx); requests from any
    # other address are judged by their own address, so the header cannot be forged.
    board_trusted_proxies: str = "127.0.0.0/8,::1/128,172.16.0.0/12"
    # How often the board asks for a new summary (the task asks for 1-2 seconds)
    board_refresh_seconds: float = Field(default=1.5, ge=1.0, le=2.0)


settings = Settings()
