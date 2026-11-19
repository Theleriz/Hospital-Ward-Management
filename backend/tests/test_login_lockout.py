"""T-48: persistent, atomic login protection with the real PostgreSQL function."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import errors

from app.auth import DB_ROLES
from app.config import settings
from app.db import role_connection
from app.main import app
from tests.conftest import ADMIN_URL, ADMISSIONS, NURSE, INACTIVE, run_as_owner

WRONG = dict(NURSE, pin='0000')


def state(badge=NURSE['badge_id']):
    with psycopg.connect(ADMIN_URL) as conn:
        return conn.execute('SELECT "Failures", "LockedUntil", "UpdatedAt" '
                            'FROM "LoginThrottle" WHERE "BadgeID" = %s', (badge,)).fetchone()


def fail(client, count=5, account=WRONG):
    for _ in range(count):
        assert client.post('/api/auth/login', json=account).status_code == 401


def test_http_401_commits_failure_state(client):
    fail(client, 1)
    assert state()[0:2] == (1, None)


def test_blocked_attempt_does_not_extend_lock_or_change_state(client):
    fail(client)
    before = state()
    for account in (WRONG, NURSE):
        response = client.post('/api/auth/login', json=account)
        assert response.status_code == 429
        assert 1 <= int(response.headers['Retry-After']) <= settings.login_lockout_seconds
        assert state() == before
    assert client.get('/api/auth/me').status_code == 401


@pytest.mark.parametrize('errors_before_restart', [4, 5])
def test_state_survives_new_application_lifespan(errors_before_restart):
    run_as_owner('TRUNCATE TABLE "LoginThrottle"')
    with TestClient(app) as first:
        fail(first, errors_before_restart)
    # No fixture/reset and a new pool/lifespan: state is in PostgreSQL, not the app.
    with TestClient(app) as second:
        if errors_before_restart == 4:
            fail(second, 1)
        assert second.post('/api/auth/login', json=NURSE).status_code == 429
        assert second.post('/api/auth/login', json=ADMISSIONS).status_code == 200


@pytest.mark.parametrize('correct', [True, False])
def test_expired_lock_allows_new_attempt(client, correct):
    fail(client)
    run_as_owner('UPDATE "LoginThrottle" SET "LockedUntil" = clock_timestamp() - INTERVAL \'1 second\'')
    response = client.post('/api/auth/login', json=NURSE if correct else WRONG)
    assert response.status_code == (200 if correct else 401)
    assert state()[0:2] == (0 if correct else 1, None)


@pytest.mark.parametrize('account', [dict(WRONG, badge_id='UNKNOWN-T48'), INACTIVE])
def test_unknown_and_inactive_badges_have_same_lockout_policy(client, account):
    fail(client, account=account)
    assert client.post('/api/auth/login', json=account).status_code == 429


def test_badge_whitespace_cannot_bypass_lock(client):
    fail(client)
    response = client.post('/api/auth/login', json=dict(NURSE, badge_id='  BADGE-1001  '))
    assert response.status_code == 429


def test_invalid_pin_format_does_not_count_as_failed_authentication(client):
    assert client.post('/api/auth/login', json=dict(NURSE, pin='abc')).status_code == 422
    assert state() is None


@pytest.mark.parametrize('body', [dict(NURSE, badge_id='   '), dict(NURSE, pin='１２３４')])
def test_blank_badge_and_non_ascii_pin_are_validation_errors(client, body):
    assert client.post('/api/auth/login', json=body).status_code == 422
    assert state() is None


def test_parallel_requests_cannot_lose_failed_attempts(client):
    with ThreadPoolExecutor(max_workers=10) as executor:
        codes = list(executor.map(lambda _: client.post('/api/auth/login', json=WRONG).status_code, range(10)))
    assert sorted(codes) == [401] * 5 + [429] * 5
    assert state()[1] is not None


@pytest.mark.parametrize('db_role', ['medbase_api', *DB_ROLES.values(), 'medbase_alert_service'])
@pytest.mark.parametrize('sql', ['SELECT * FROM "LoginThrottle"', 'DELETE FROM "LoginThrottle"'])
def test_login_state_cannot_be_read_or_cleared_by_application_roles(client, db_role, sql):
    with pytest.raises(errors.InsufficientPrivilege):
        with role_connection(client.app.state.pool, db_role) as conn:
            conn.execute(sql)


def test_backend_cannot_bypass_throttle_using_old_function(client):
    with pytest.raises(errors.InsufficientPrivilege):
        with client.app.state.pool.connection() as conn:
            conn.execute("SELECT * FROM fn_AuthenticateStaff('BADGE-1001', '1111')")


@pytest.mark.parametrize('db_role', list(DB_ROLES.values()) + ['medbase_alert_service'])
def test_user_roles_cannot_run_login_function(client, db_role):
    with pytest.raises(errors.InsufficientPrivilege):
        with role_connection(client.app.state.pool, db_role) as conn:
            conn.execute("SELECT * FROM fn_LoginStaff('BADGE-1001', '1111', 5, 300)")


def test_unavailable_database_does_not_create_a_session(client, monkeypatch):
    def unavailable(*args, **kwargs):
        raise psycopg.OperationalError('test failure: connection unavailable')
    monkeypatch.setattr(client.app.state.pool, 'connection', unavailable)
    response = client.post('/api/auth/login', json=NURSE)
    assert response.status_code == 503
    assert response.json() == {'detail': 'Вход временно недоступен'}
    assert client.get('/api/auth/me').status_code == 401


def test_reapplying_additive_migration_preserves_data_and_lock(client):
    fail(client)
    before = state()
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        before_rows = conn.execute('SELECT COUNT(*) FROM "Patient"').fetchone()
        before_events = conn.execute('SELECT COUNT(*) FROM "AlertEvent"').fetchone()
        source = Path(__file__).resolve().parents[2] / 'db' / '06_login_security.sql'
        conn.execute(source.read_text(encoding='utf-8'))
        assert conn.execute('SELECT COUNT(*) FROM "Patient"').fetchone() == before_rows
        assert conn.execute('SELECT COUNT(*) FROM "AlertEvent"').fetchone() == before_events
    assert state() == before
    assert client.post('/api/auth/login', json=NURSE).status_code == 429
