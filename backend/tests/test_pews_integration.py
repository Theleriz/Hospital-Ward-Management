"""PEWS request flow against the dedicated fictional-data test database."""

import psycopg

from conftest import ADMIN_URL, NURSE, login, run_as_owner


def add_pediatric_admission():
    run_as_owner(
        '''INSERT INTO "Ward" ("WardID", "WardName", "FloorNum", "Capacity", "WardType")
           VALUES (9901, 'Учебная детская палата PEWS', 9, 4, 'Paediatrics')'''
    )
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        patient_id = conn.execute(
            '''INSERT INTO "Patient" ("FullName", "DOB", "Phone", "Gender")
               VALUES ('Ребёнок Учебный PEWS', DATE '2018-01-01', 'TEST-PEWS-01', 'Female')
               RETURNING "PatientID"'''
        ).fetchone()[0]
        conn.execute(
            '''INSERT INTO "Admission" ("PatientID", "WardID", "AdmitDate", "Status")
               VALUES (%s, 9901, CURRENT_DATE, 'Active')''', (patient_id,)
        )
    return patient_id


def body(patient_id, **changes):
    value = {
        "patient_id": patient_id,
        "respiratory_rate": 20,
        "respiratory_distress": "NONE",
        "spo2": 98,
        "oxygen_device": "AIR",
        "oxygen_delivery_pct": None,
        "heart_rate": 100,
        "systolic": 90,
        "crt_seconds": 2,
        "temperature": 36.8,
        "temperature_route": "AXILLA",
        "avpu": "A",
        "sepsis_suspected": False,
        "septic_shock_suspected": False,
        "clinical_intuition": False,
        "carer_response": "S",
        "risk_factors_confirmed": True,
        "risk_factors": [],
        "measurement_confirmed": True,
    }
    value.update(changes)
    return value


def counts():
    with psycopg.connect(ADMIN_URL) as conn:
        reviews = conn.execute('SELECT count(*) FROM "StaffReviewRequest"').fetchone()[0]
        alerts = conn.execute('SELECT count(*) FROM "WardAlert"').fetchone()[0]
    return reviews, alerts


def test_assessment_does_not_create_request_or_emergency_alert_until_button_click(client, seed_data):
    patient_id = add_pediatric_admission()
    login(client, NURSE)
    before = counts()

    incomplete = client.post("/api/simulator/assess-pews", json=body(
        patient_id, respiratory_rate=None, measurement_confirmed=False,
        clinical_intuition=True, carer_response="W", sepsis_suspected=True,
        avpu="U", temperature=39, risk_factors=["OUTLIER"],
    ))
    assert incomplete.status_code == 200, incomplete.text
    assert incomplete.json()["status"] == "REVIEW_REQUIRED"
    assert incomplete.json()["score"] is None
    assert len(incomplete.json()["signals"]) == 6
    assert counts() == before

    submitted = client.post("/api/staff-reviews", json={
        "patient_id": patient_id, "reason": incomplete.json()["reason"],
    })
    assert submitted.status_code == 201, submitted.text
    repeated = client.post("/api/staff-reviews", json={
        "patient_id": patient_id, "reason": incomplete.json()["reason"],
    })
    assert repeated.status_code == 201, repeated.text
    assert repeated.json()["request_id"] == submitted.json()["request_id"]
    after_request = counts()
    assert after_request == (before[0] + 1, before[1])

    low = client.post("/api/simulator/assess-pews", json=body(
        patient_id, clinical_intuition=True, systolic=100,
    ))
    assert low.status_code == 200, low.text
    assert low.json()["status"] == "CLASSIFIED"
    assert low.json()["score"] <= 4
    assert any("Клиническая интуиция" in signal for signal in low.json()["signals"])
    assert counts() == after_request


def test_simulator_requires_real_active_admission_and_pediatric_ward_type(client, seed_data):
    patient_id = add_pediatric_admission()
    login(client, NURSE)
    valid = client.post("/api/simulator/assess-pews", json=body(patient_id))
    assert valid.status_code == 200, valid.text
    assert valid.json()["chart_key"] == "5_12_YEARS"

    run_as_owner('UPDATE "Ward" SET "WardType" = \'Neonatal\' WHERE "WardID" = 9901')
    neonatal = client.post("/api/simulator/assess-pews", json=body(patient_id))
    assert neonatal.status_code == 200, neonatal.text
    assert neonatal.json()["status"] == "REVIEW_REQUIRED"
    assert neonatal.json()["score"] is None


def test_context_lookup_is_narrow_and_service_role_has_no_direct_dob_access():
    with psycopg.connect(ADMIN_URL) as conn:
        direct = conn.execute(
            '''SELECT has_column_privilege('medbase_alert_service', '"Patient"'::regclass, 'DOB', 'SELECT'),
                      has_function_privilege('medbase_alert_service', 'fn_GetActivePewsContext(INT)', 'EXECUTE')'''
        ).fetchone()
    assert direct == (False, True)


def test_api_accepts_published_oxygen_modes_and_absent_pressure_codes(client, seed_data):
    patient_id = add_pediatric_admission()
    login(client, NURSE)

    for device, percentage in (("HIGH_FLOW", 21), ("HIGH_FLOW", 100),
                               ("BIPAP", 24), ("CPAP", 100)):
        response = client.post("/api/simulator/assess-pews", json=body(
            patient_id, oxygen_device=device, oxygen_delivery_pct=percentage,
        ))
        assert response.status_code == 200, response.text
        assert response.json()["component_scores"]["oxygen_delivery"] == 4

    for flow, expected in ((0.1, 1), (4, 2), (8, 4), (15, 4)):
        response = client.post("/api/simulator/assess-pews", json=body(
            patient_id, oxygen_device="OXYGEN", oxygen_delivery_unit="L_MIN",
            oxygen_delivery_lpm=flow,
        ))
        assert response.status_code == 200, response.text
        assert response.json()["component_scores"]["oxygen_delivery"] == expected

    for code, expected in (("NCO", 0), ("U0", 0), ("U4", 4)):
        response = client.post("/api/simulator/assess-pews", json=body(
            patient_id, systolic=None, systolic_code=code,
        ))
        assert response.status_code == 200, response.text
        assert response.json()["component_scores"]["systolic_blood_pressure"] == expected
