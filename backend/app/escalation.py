"""Escalation of overdue alerts (UC-7, decisions.md record 1).

Every couple of seconds the backend looks for HIGH/CRITICAL alerts nobody has
acknowledged: PENDING ones older than 30 seconds, and ESCALATED ones whose last
escalation is older than 30 seconds (repeat escalation, decisions.md record 9).
Each goes to an Available nurse other than the assigned one and the current
recipient: a nurse of the same ward first, then one working on the same floor,
then anyone. sp_EscalateAlert re-checks the rules, so an alert that was
acknowledged in the meantime is simply skipped.
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

# Not acknowledged for 30 s since creation (PENDING) or since the last escalation (ESCALATED)
OVERDUE_SQL = """
    SELECT "AlertID", "WardID", "AssignedNurseID", "EscalatedToNurseID"
    FROM "WardAlert"
    WHERE "Priority" IN ('HIGH', 'CRITICAL')
      AND (("Status" = 'PENDING' AND "CreatedAt" <= CURRENT_TIMESTAMP - make_interval(secs => %(after)s))
           OR ("Status" = 'ESCALATED' AND "EscalatedAt" <= CURRENT_TIMESTAMP - make_interval(secs => %(after)s)))
    ORDER BY CASE "Priority" WHEN 'CRITICAL' THEN 1 ELSE 2 END, "CreatedAt"
"""

# An Available nurse other than the assigned one and the current recipient:
# a nurse of the alert's ward first, then one working on the same floor, then anyone
TARGET_SQL = """
    SELECT n."NurseID"
    FROM "Nurse" n
    WHERE n."Status" = 'Available'
      AND n."NurseID" IS DISTINCT FROM %(assigned)s
      AND n."NurseID" IS DISTINCT FROM %(escalated)s
    ORDER BY
      NOT EXISTS (SELECT 1 FROM "NurseAssignment" x
                  WHERE x."NurseID" = n."NurseID" AND x."WardID" = %(ward)s),
      NOT EXISTS (SELECT 1 FROM "NurseAssignment" x JOIN "Ward" w ON w."WardID" = x."WardID"
                  WHERE x."NurseID" = n."NurseID"
                    AND w."FloorNum" = (SELECT "FloorNum" FROM "Ward" WHERE "WardID" = %(ward)s)),
      n."NurseID"
    LIMIT 1
"""


def escalate_overdue(pool: ConnectionPool) -> list[tuple[str, str]]:
    """One escalation round over every overdue alert; returns (alert, nurse) pairs escalated."""
    escalated = []
    with role_connection(pool, ALERT_SERVICE_ROLE) as conn:
        overdue = conn.execute(OVERDUE_SQL, {"after": ESCALATE_AFTER_SECONDS}).fetchall()

        for alert_id, ward_id, assigned, escalated_to in overdue:
            target = conn.execute(
                TARGET_SQL, {"ward": ward_id, "assigned": assigned, "escalated": escalated_to}
            ).fetchone()
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
