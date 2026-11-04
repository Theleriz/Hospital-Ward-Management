"""Backend settings, read from environment variables (MEDBASE_*)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MEDBASE_")

    # Default matches the database from docker-compose.yml when the backend runs on the host
    database_url: str = "postgresql://medbase:medbase@127.0.0.1:55440/hospital_ward"
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10


settings = Settings()
