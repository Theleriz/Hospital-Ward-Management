"""Badges with a barcode (/api/badges): print list and reissue (new-features plan, part 2).

Rules:
  - only the head nurse sees the badge list and reissues badges;
  - the list holds name, role and badge number, never the PIN or its hash;
  - after a reissue the old number no longer logs in, the new one does with the same PIN;
  - an old number is never handed out again.
"""

import psycopg
import pytest

from tests.conftest import ADMIN_URL, ADMISSIONS, HEAD_NURSE, NURSE, PUBLIC_STAFF, login

pytestmark = pytest.mark.usefixtures("seed_data")


def badges(client) -> dict[str, dict]:
    login(client, HEAD_NURSE)
    response = client.get("/api/badges")
    assert response.status_code == 200, response.text
    return {b["person_id"]: b for b in response.json()}


def test_head_nurse_sees_every_active_account_with_its_badge(client):
    shown = badges(client)

    assert shown["NURSE-01"] == {
        "person_id": "NURSE-01", "full_name": "Aigerim Sadykova", "role": "Nurse", "badge_id": "BADGE-1001",
    }
    assert shown["ADM-01"]["badge_id"] == "BADGE-2001"
    assert shown["STAFF-01"]["role"] == "PublicStaff"
    # An inactive account cannot log in, so there is nothing to print
    assert "ADM-02" not in shown


def test_badge_list_has_no_pin(client):
    login(client, HEAD_NURSE)
    for badge in client.get("/api/badges").json():
        assert set(badge) == {"person_id", "full_name", "role", "badge_id"}


@pytest.mark.parametrize("account", [NURSE, ADMISSIONS, PUBLIC_STAFF])
def test_only_the_head_nurse(client, account):
    login(client, account)
    assert client.get("/api/badges").status_code == 403
    assert client.post("/api/badges/NURSE-01/reissue").status_code == 403


def test_login_required(client):
    assert client.get("/api/badges").status_code == 401


def test_reissue_gives_a_new_number_and_the_old_one_stops_working(client):
    login(client, HEAD_NURSE)
    response = client.post("/api/badges/NURSE-01/reissue")
    assert response.status_code == 200, response.text
    new_badge = response.json()["badge_id"]

    assert new_badge != "BADGE-1001"
    assert new_badge.startswith("BADGE-")
    assert client.post("/api/auth/login", json={"badge_id": "BADGE-1001", "pin": "1111"}).status_code == 401
    assert client.post("/api/auth/login", json={"badge_id": new_badge, "pin": "1111"}).status_code == 200


def test_reissue_works_for_other_staff_too(client):
    login(client, HEAD_NURSE)
    new_badge = client.post("/api/badges/ADM-01/reissue").json()["badge_id"]

    assert client.post("/api/auth/login", json={"badge_id": new_badge, "pin": "2001"}).json()["role"] == "Admissions"


def test_reissue_records_the_old_number_so_it_is_never_reused(client):
    login(client, HEAD_NURSE)
    client.post("/api/badges/NURSE-02/reissue")

    with psycopg.connect(ADMIN_URL) as conn:
        row = conn.execute(
            'SELECT "PersonID", "RetiredBy" FROM "RetiredBadge" WHERE "BadgeID" = %s', ("BADGE-1002",)
        ).fetchone()
    assert row == ("NURSE-02", "NURSE-10")


@pytest.mark.parametrize("person", ["NURSE-99", "ADM-02"])
def test_reissue_of_unknown_or_inactive_person_is_404(client, person):
    login(client, HEAD_NURSE)
    assert client.post(f"/api/badges/{person}/reissue").status_code == 404
