import os
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import login_throttle
from app.main import app

# Test accounts from db/04_seed.sql
NURSE = {"badge_id": "BADGE-1001", "pin": "1111"}
HEAD_NURSE = {"badge_id": "BADGE-1010", "pin": "1010"}
ADMISSIONS = {"badge_id": "BADGE-2001", "pin": "2001"}
PUBLIC_STAFF = {"badge_id": "BADGE-3001", "pin": "3001"}
INACTIVE = {"badge_id": "BADGE-2002", "pin": "2002"}

SEED_SQL = Path(__file__).resolve().parents[2] / "db" / "04_seed.sql"
# Owner of the database: only tests use it, to reload the seed data
ADMIN_URL = os.environ.get(
    "MEDBASE_TEST_ADMIN_URL", "postgresql://medbase:medbase@127.0.0.1:55440/hospital_ward"
)


@pytest.fixture
def client():
    login_throttle.reset()
    # The context manager runs the lifespan, so the connection pool is opened
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def seed_data():
    """Reload db/04_seed.sql, so a test that changes data starts from the known state."""
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(SEED_SQL.read_text(encoding="utf-8"))


def login(client: TestClient, account: dict) -> None:
    response = client.post("/api/auth/login", json=account)
    assert response.status_code == 200, response.text
