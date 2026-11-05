"""Escalation of overdue alerts (UC-7, decisions.md record 1).

Every couple of seconds the backend looks for PENDING HIGH/CRITICAL alerts older
than 30 seconds and forwards each one to an Available nurse: one of the same
ward first, then anyone. sp_EscalateAlert re-checks the rules, so an alert that
was acknowledged in the meantime is simply skipped.
"""

import logging
import threading

from psycopg import errors
from psycopg_pool import ConnectionPool

from app.db import role_connection

logger = logging.getLogger(__name__)

ALERT_SERVICE_ROLE = "medbase_alert_service"

# The same limit is checked by sp_EscalateAlert
ESCALATE_AFTER_SECONDS = 30

OVERDUE_SQL = """
    SELECT "AlertID", "WardID", "AssignedNurseID"
    FROM "WardAlert"
    WHERE "Status" = 'PENDING'
      AND "Priority" IN ('HIGH', 'CRITICAL')
      AND "CreatedAt" <= CURRENT_TIMESTAMP - make_interval(secs => %s)
    ORDER BY CASE "Priority" WHEN 'CRITICAL' THEN 1 ELSE 2 END, "CreatedAt"
"""

# An Available nurse other than the assigned one, nurses of the alert's ward first
TARGET_SQL = """
    SELECT n."NurseID"
    FROM "Nurse" n
    LEFT JOIN "NurseAssignment" x ON x."NurseID" = n."NurseID" AND x."WardID" = %s
    WHERE n."Status" = 'Available' AND n."NurseID" IS DISTINCT FROM %s
    ORDER BY x."NurseID" IS NULL, n."NurseID"
    LIMIT 1
"""


def escalate_overdue(pool: ConnectionPool) -> list[tuple[str, str]]:
    """Escalate every overdue alert once; returns (alert, nurse) pairs escalated."""
    escalated = []
    with role_connection(pool, ALERT_SERVICE_ROLE) as conn:
        overdue = conn.execute(OVERDUE_SQL, (ESCALATE_AFTER_SECONDS,)).fetchall()

        for alert_id, ward_id, assigned in overdue:
            target = conn.execute(TARGET_SQL, (ward_id, assigned)).fetchone()
            if target is None:
                logger.warning("Alert %s is overdue, but no nurse is Available", alert_id)
                continue
            try:
                # Savepoint: a refusal for one alert must not undo the others
                with conn.transaction():
                    conn.execute("CALL sp_EscalateAlert(%s, %s)", (alert_id, target[0]))
            except errors.RaiseException as exc:
                logger.info("Alert %s was not escalated: %s", alert_id, exc.diag.message_primary)
                continue
            logger.info("Alert %s escalated to %s", alert_id, target[0])
            escalated.append((alert_id, target[0]))
    return escalated


class EscalationWorker(threading.Thread):
    """Runs escalate_overdue every `interval` seconds until stopped."""

    def __init__(self, pool: ConnectionPool, interval: float):
        super().__init__(name="escalation-worker", daemon=True)
        self.pool = pool
        self.interval = interval
        self._stop_event = threading.Event()

    def run(self) -> None:
        while not self._stop_event.wait(self.interval):
            try:
                escalate_overdue(self.pool)
            except Exception:
                # The database may be restarting; try again on the next round
                logger.exception("Escalation round failed")

    def stop(self) -> None:
        self._stop_event.set()
        self.join(timeout=5)
