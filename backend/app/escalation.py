"""Escalation of overdue alerts (UC-7, decisions.md record 1).

Every couple of seconds the backend looks for HIGH/CRITICAL alerts nobody has
acknowledged: PENDING ones older than 30 seconds, and ESCALATED ones whose last
escalation is older than 30 seconds (repeat escalation, decisions.md record 9).
Each goes to a nurse on shift who was not called for this alert yet and is not
the assigned one (decisions.md record 10), in this order:

  1. an Available nurse: of the same ward, then of the same floor, then anyone;
  2. the head nurse, if Available;
  3. a Busy nurse of the same ward or floor: busy, but on duty and close by;
  4. the head nurse, if Busy;
  5. any other Busy nurse.

So an alert never stays unheard while somebody is on shift, and it does not bounce
between two nurses who do not answer. sp_EscalateAlert re-checks the rules, so an
alert that was acknowledged in the meantime is simply skipped.
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
    SELECT "AlertID", "WardID", "AssignedNurseID"
    FROM "WardAlert"
    WHERE "Priority" IN ('HIGH', 'CRITICAL')
      AND (("Status" = 'PENDING' AND "CreatedAt" <= CURRENT_TIMESTAMP - make_interval(secs => %(after)s))
           OR ("Status" = 'ESCALATED' AND "EscalatedAt" <= CURRENT_TIMESTAMP - make_interval(secs => %(after)s)))
    ORDER BY CASE "Priority" WHEN 'CRITICAL' THEN 1 ELSE 2 END, "CreatedAt"
"""

# The next nurse to call, in the order described at the top of this module.
# Nurses already called for this alert (ESCALATED events) are skipped,
# the current recipient included.
TARGET_SQL = """
    WITH candidate AS (
        SELECT n."NurseID", n."Status", n."Role",
               EXISTS (SELECT 1 FROM "NurseAssignment" x
                       WHERE x."NurseID" = n."NurseID" AND x."WardID" = %(ward)s) AS in_ward,
               EXISTS (SELECT 1 FROM "NurseAssignment" x JOIN "Ward" w ON w."WardID" = x."WardID"
                       WHERE x."NurseID" = n."NurseID"
                         AND w."FloorNum" = (SELECT "FloorNum" FROM "Ward" WHERE "WardID" = %(ward)s))
                   AS on_floor
        FROM "Nurse" n
        WHERE n."Status" IN ('Available', 'Busy')
          AND n."NurseID" IS DISTINCT FROM %(assigned)s
          AND NOT EXISTS (SELECT 1 FROM "AlertEvent" e
                          WHERE e."AlertID" = %(alert)s AND e."EventType" = 'ESCALATED'
                            AND e."NurseID" = n."NurseID")
    )
    SELECT "NurseID"
    FROM candidate
    ORDER BY
      CASE
        WHEN "Status" = 'Available' AND "Role" = 'Nurse' THEN 1
        WHEN "Status" = 'Available' THEN 2
        WHEN "Role" = 'Nurse' AND on_floor THEN 3
        WHEN "Role" = 'HeadNurse' THEN 4
        ELSE 5
      END,
      NOT in_ward, NOT on_floor, "NurseID"
    LIMIT 1
"""


def escalate_overdue(pool: ConnectionPool) -> list[tuple[str, str]]:
    """One escalation round over every overdue alert; returns (alert, nurse) pairs escalated."""
    escalated = []
    with role_connection(pool, ALERT_SERVICE_ROLE) as conn:
        overdue = conn.execute(OVERDUE_SQL, {"after": ESCALATE_AFTER_SECONDS}).fetchall()

        for alert_id, ward_id, assigned in overdue:
            target = conn.execute(
                TARGET_SQL, {"alert": alert_id, "ward": ward_id, "assigned": assigned}
            ).fetchone()
            if target is None:
                logger.warning("Alert %s is overdue, but every nurse on shift was already called", alert_id)
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
