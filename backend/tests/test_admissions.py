"""Ward board (T-23) and admissions desk (T-22).

Seed state (db/04_seed.sql): ward 101 is full (patients 1, 2), ward 102 has
patients 3 and 4, wards 103 and 104 are empty, patients 5-8 are not admitted.
"""

import pytest

from tests.conftest import ADMISSIONS, HEAD_NURSE, NURSE, PUBLIC_STAFF, login

pytestmark = pytest.mark.usefixtures("seed_data")

NEW_PATIENT = {
    "full_name": "Dana Seitkali",
    "dob": "1990-02-14",
    "phone": "+77015550109",
    "gender": "Female",
    "ward_id": 104,
}


def wards_by_id(client) -> dict:
    return {w["ward_id"]: w for w in client.get("/api/wards").json()}


# --- Ward board -------------------------------------------------------------------

@pytest.mark.parametrize("account", [ADMISSIONS, PUBLIC_STAFF, NURSE, HEAD_NURSE])
def test_every_role_sees_the_ward_board(client, account):
    login(client, account)

    wards = wards_by_id(client)

    assert set(wards) == {101, 102, 103, 104}
    assert wards[101]["occupied"] == 2 and wards[101]["available"] == 0
    assert wards[102]["available"] == 2


def test_ward_board_has_no_patient_data(client):
    login(client, PUBLIC_STAFF)

    ward = client.get("/api/wards").json()[0]

    assert set(ward) == {"ward_id", "ward_name", "floor", "ward_type", "capacity", "occupied", "available"}


def test_ward_board_requires_login(client):
    assert client.get("/api/wards").status_code == 401


# --- Who may use the admissions desk ------------------------------------------------

@pytest.mark.parametrize("account", [PUBLIC_STAFF, NURSE, HEAD_NURSE])
def test_other_roles_cannot_use_the_admissions_desk(client, account):
    login(client, account)

    assert client.get("/api/admissions/active").status_code == 403
    assert client.post("/api/admissions", json=NEW_PATIENT).status_code == 403
    assert client.post("/api/admissions/1/discharge").status_code == 403


def test_admissions_desk_requires_login(client):
    assert client.get("/api/admissions/active").status_code == 401


# --- UC-1: admit --------------------------------------------------------------------

def test_list_of_admitted_patients(client):
    login(client, ADMISSIONS)

    active = client.get("/api/admissions/active").json()

    assert sorted(a["patient_id"] for a in active) == [1, 2, 3, 4]
    assert {a["ward_id"] for a in active} == {101, 102}


def test_admit_new_patient(client):
    login(client, ADMISSIONS)

    response = client.post("/api/admissions", json=NEW_PATIENT)

    assert response.status_code == 201
    body = response.json()
    assert body["full_name"] == "Dana Seitkali"
    assert body["ward_id"] == 104
    assert wards_by_id(client)[104]["occupied"] == 1


def test_returning_patient_is_found_by_phone(client):
    login(client, ADMISSIONS)

    # Patient 8 (Anna Petrova) is in the seed but not admitted
    response = client.post("/api/admissions", json={**NEW_PATIENT, "full_name": "Anna Petrova",
                                                    "phone": "+77015550108", "ward_id": 103})

    assert response.status_code == 201
    assert response.json()["patient_id"] == 8


def test_admit_to_full_ward_is_refused(client):
    login(client, ADMISSIONS)

    response = client.post("/api/admissions", json={**NEW_PATIENT, "ward_id": 101})

    assert response.status_code == 409
    assert "нет свободных мест" in response.json()["detail"]
    assert len(client.get("/api/admissions/active").json()) == 4


def test_admit_already_admitted_patient_asks_for_transfer(client):
    login(client, ADMISSIONS)

    # Patient 1 is in ward 101; admitting by phone must not silently move them
    response = client.post("/api/admissions", json={**NEW_PATIENT, "phone": "+77015550101", "ward_id": 104})

    assert response.status_code == 409
    assert "перевод" in response.json()["detail"]


def test_admit_to_unknown_ward(client):
    login(client, ADMISSIONS)

    assert client.post("/api/admissions", json={**NEW_PATIENT, "ward_id": 999}).status_code == 404


@pytest.mark.parametrize(
    "change",
    [{"phone": "12-34"}, {"full_name": "A"}, {"gender": "Unknown"}, {"dob": "2999-01-01"}],
    ids=["phone", "name", "gender", "future-dob"],
)
def test_admit_rejects_invalid_input(client, change):
    login(client, ADMISSIONS)

    assert client.post("/api/admissions", json={**NEW_PATIENT, **change}).status_code == 422


# --- UC-2: transfer -----------------------------------------------------------------

def test_transfer_to_another_ward(client):
    login(client, ADMISSIONS)

    response = client.post("/api/admissions/3/transfer", json={"ward_id": 103})

    assert response.status_code == 200
    assert response.json()["ward_id"] == 103
    wards = wards_by_id(client)
    assert wards[102]["occupied"] == 1 and wards[103]["occupied"] == 1


def test_transfer_to_full_ward_is_refused(client):
    login(client, ADMISSIONS)

    response = client.post("/api/admissions/3/transfer", json={"ward_id": 101})

    assert response.status_code == 409
    assert wards_by_id(client)[102]["occupied"] == 2


def test_transfer_to_the_same_ward_is_refused(client):
    login(client, ADMISSIONS)

    assert client.post("/api/admissions/3/transfer", json={"ward_id": 102}).status_code == 409


def test_transfer_of_patient_not_admitted(client):
    login(client, ADMISSIONS)

    assert client.post("/api/admissions/5/transfer", json={"ward_id": 103}).status_code == 404



# --- UC-3: discharge ------------------------------------------------------

def test_discharge(client):
    login(client, ADMISSIONS)

    assert client.post("/api/admissions/4/discharge").status_code == 204

    assert 4 not in [
        a["patient_id"]
        for a in client.get("/api/admissions/active").json()
    ]
    assert wards_by_id(client)[102]["occupied"] == 1


def test_discharge_of_patient_not_admitted(client):
    login(client, ADMISSIONS)

    assert client.post("/api/admissions/5/discharge").status_code == 404


# --- UC-1 to UC-4: Complete patient lifecycle ----------------------------

def test_patient_admission_transfer_discharge_lifecycle(client):
    login(client, ADMISSIONS)

    # 1. Check initial ward occupancy
    wards = wards_by_id(client)
    assert wards[102]["occupied"] == 2
    assert wards[102]["available"] == 2
    assert wards[103]["occupied"] == 0
    assert wards[103]["available"] == 3

    # 2. Admit a new patient to Ward 102
    patient = {
        **NEW_PATIENT,
        "ward_id": 102,
    }

    response = client.post("/api/admissions", json=patient)
    assert response.status_code == 201
    patient_id = response.json()["patient_id"]

    wards = wards_by_id(client)
    assert wards[102]["occupied"] == 3
    assert wards[102]["available"] == 1

    # 3. Transfer the patient to Ward 103
    response = client.post(
        f"/api/admissions/{patient_id}/transfer",
        json={"ward_id": 103},
    )
    assert response.status_code == 200

    wards = wards_by_id(client)
    assert wards[102]["occupied"] == 2
    assert wards[102]["available"] == 2
    assert wards[103]["occupied"] == 1
    assert wards[103]["available"] == 2

    # 4. Discharge the patient
    response = client.post(f"/api/admissions/{patient_id}/discharge")
    assert response.status_code == 204

    wards = wards_by_id(client)
    assert wards[102]["occupied"] == 2
    assert wards[102]["available"] == 2
    assert wards[103]["occupied"] == 0
    assert wards[103]["available"] == 3

    # 5. Verify the patient is no longer actively admitted
    active = client.get("/api/admissions/active").json()
    assert patient_id not in [a["patient_id"] for a in active]

    # 6. Verify that ward occupancy matches active admissions
    wards = wards_by_id(client)
    active = client.get("/api/admissions/active").json()

    for ward_id, ward in wards.items():
        actual_patients = sum(
            1 for admission in active
            if admission["ward_id"] == ward_id
        )

        assert ward["occupied"] == actual_patients
        assert ward["available"] == ward["capacity"] - actual_patients

