"""Smoke tests: the backend starts and reaches the database.

Needs the database from docker-compose.yml (MEDBASE_DATABASE_URL to override).
"""

def test_health_reports_database_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_reports_unavailable_database(client, monkeypatch):
    def broken_connection(*_args, **_kwargs):
        raise TimeoutError("pool timeout")

    monkeypatch.setattr(client.app.state.pool, "connection", broken_connection)

    response = client.get("/api/health")

    assert response.status_code == 503
    assert response.json() == {"status": "error", "database": "unavailable"}


def test_api_docs_are_served(client):
    assert client.get("/api/openapi.json").status_code == 200
