"""Create a Doctor login and explicitly assign one patient (admin-only tool)."""

from __future__ import annotations

import os
import re
import sys
from getpass import getpass

import psycopg


def ask(label: str) -> str:
    value = input(f"{label}: ").strip()
    if not value:
        raise ValueError(f"{label} must not be empty")
    return value


def main() -> int:
    database_url = os.environ.get("MEDBASE_ADMIN_DATABASE_URL")
    if not database_url:
        print("Set MEDBASE_ADMIN_DATABASE_URL to an administrator/owner connection.", file=sys.stderr)
        return 2

    try:
        account_id = ask("New account ID")
        full_name = ask("Doctor display name")
        badge_id = ask("Badge ID")
        patient_id = int(ask("Patient ID to assign"))
        pin = getpass("PIN (4–12 digits): ")
        if not re.fullmatch(r"\d{4,12}", pin):
            raise ValueError("PIN must contain 4 to 12 digits")
        if getpass("Repeat PIN: ") != pin:
            raise ValueError("PIN entries do not match")

        with psycopg.connect(database_url) as conn:
            if conn.execute('SELECT 1 FROM "Patient" WHERE "PatientID" = %s', (patient_id,)).fetchone() is None:
                raise ValueError(f"Patient {patient_id} does not exist")
            if conn.execute(
                'SELECT 1 FROM "StaffAccount" WHERE "AccountID" = %s OR "BadgeID" = %s',
                (account_id, badge_id),
            ).fetchone() is not None:
                raise ValueError("Account ID or badge already exists; no changes made")
            if conn.execute('SELECT 1 FROM "Nurse" WHERE "BadgeID" = %s', (badge_id,)).fetchone() is not None:
                raise ValueError("Badge already belongs to a nurse; no changes made")

            conn.execute(
                '''INSERT INTO "StaffAccount" ("AccountID", "FullName", "BadgeID", "PinHash", "Role", "IsActive")
                   VALUES (%s, %s, %s, crypt(%s, gen_salt('bf')), 'Doctor', TRUE)''',
                (account_id, full_name, badge_id, pin),
            )
            conn.execute(
                '''INSERT INTO "DoctorPatientAssignment" ("DoctorAccountID", "PatientID")
                   VALUES (%s, %s)''',
                (account_id, patient_id),
            )

        print(f"Created Doctor account {account_id} and assigned patient {patient_id}.")
        return 0
    except (ValueError, psycopg.Error) as exc:
        print(f"No account created: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
