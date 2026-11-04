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


@pytest.fixture
def client():
    login_throttle.reset()
    # The context manager runs the lifespan, so the connection pool is opened
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, account: dict) -> None:
    response = client.post("/api/auth/login", json=account)
    assert response.status_code == 200, response.text
