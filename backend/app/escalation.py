"""Escalation of overdue alerts (UC-7, decisions.md record 1).

Every couple of seconds the backend looks for HIGH/CRITICAL alerts nobody has
acknowledged: PENDING ones older than 30 seconds, and ESCALATED ones whose last
escalation is older than 30 seconds (repeat escalation, decisions.md record 9).
Each goes to a nurse on shift who was not called for this alert yet and is not
the assigned one (decisions.md record 12), in this order:

  1. a free nurse (Available, not answering another emergency), the nearest first;
  2. the head nurse, if free;
  3. an Available nurse who is answering other emergencies, fewest first
     (decisions.md record 13), then the head nurse in the same situation;
  4. a Busy nurse in or near the ward (same floor): busy, but on duty and close by;
  5. the head nurse, if Busy;
  6. any other Busy nurse.

"Nearest" (decisions.md record 14) is where the nurse is right now, as the door
badge reader of a ward last saw her or him (fresh for LOCATION_FRESH_MINUTES):
in the alert's ward, then on its floor, then fewer floors away. If the location
is unknown or old, the work schedule decides: works in the ward, then on the floor.
Inside each group: nearest, then fewer open emergencies, then the nurse ID
(only to make the choice repeatable).

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

# Where a nurse is right now counts while the door reader saw her or him recently
# (decisions.md record 14); after that the work schedule is used instead
LOCATION_FRESH_MINUTES = 60

# The next nurse to call, in the order described at the top of this module.
# Nurses already called for this alert (ESCALATED events) are skipped,
# the current recipient included.
TARGET_SQL = """
    WITH here AS (
        SELECT "WardID", "FloorNum" FROM "Ward" WHERE "WardID" = %(ward)s
    ),
    candidate AS (
        SELECT n."NurseID", n."Status", n."Role",
               -- Emergencies she or he is answering right now (decisions.md record 13)
               (SELECT COUNT(*) FROM "WardAlert" o
                WHERE o."Priority" IN ('HIGH', 'CRITICAL')
                  AND ((o."Status" = 'PENDING' AND o."AssignedNurseID" = n."NurseID")
                       OR (o."Status" = 'ESCALATED' AND o."EscalatedToNurseID" = n."NurseID"))) AS open_calls,
               -- Where she or he is now (decisions.md record 14)
               n."LocationAt" > CURRENT_TIMESTAMP - make_interval(mins => %(fresh)s) AS located,
               n."CurrentWardID" = here."WardID" AS now_in_ward,
               loc."FloorNum" = here."FloorNum" AS now_on_floor,
               ABS(loc."FloorNum" - here."FloorNum") AS floors_away,
               -- Where she or he works by the schedule (used when the location is unknown)
               EXISTS (SELECT 1 FROM "NurseAssignment" x
                       WHERE x."NurseID" = n."NurseID" AND x."WardID" = here."WardID") AS works_in_ward,
               EXISTS (SELECT 1 FROM "NurseAssignment" x JOIN "Ward" w ON w."WardID" = x."WardID"
                       WHERE x."NurseID" = n."NurseID" AND w."FloorNum" = here."FloorNum") AS works_on_floor
        FROM "Nurse" n
        CROSS JOIN here
        LEFT JOIN "Ward" loc ON loc."WardID" = n."CurrentWardID"
        WHERE n."Status" IN ('Available', 'Busy')
          AND n."NurseID" IS DISTINCT FROM %(assigned)s
          AND NOT EXISTS (SELECT 1 FROM "AlertEvent" e
                          WHERE e."AlertID" = %(alert)s AND e."EventType" = 'ESCALATED'
                            AND e."NurseID" = n."NurseID")
    ),
    ranked AS (
        SELECT *,
               CASE
                 WHEN located AND now_in_ward THEN 0          -- in the ward right now
                 WHEN located AND now_on_floor THEN 1         -- on the floor right now
                 WHEN located IS NOT TRUE AND works_in_ward THEN 2
                 WHEN located IS NOT TRUE AND works_on_floor THEN 3
                 ELSE 4                                       -- another floor or unknown
               END AS distance
        FROM candidate
    )
    SELECT "NurseID"
    FROM ranked
    ORDER BY
      CASE
        WHEN "Status" = 'Available' AND open_calls = 0 AND "Role" = 'Nurse' THEN 1
        WHEN "Status" = 'Available' AND open_calls = 0 THEN 2
        WHEN "Status" = 'Available' AND "Role" = 'Nurse' THEN 3
        WHEN "Status" = 'Available' THEN 4
        WHEN "Role" = 'Nurse' AND distance <= 3 THEN 5
        WHEN "Role" = 'HeadNurse' THEN 6
        ELSE 7
      END,
      distance,
      CASE WHEN located THEN floors_away END NULLS LAST,
      open_calls, "NurseID"
    LIMIT 1
"""

def escalate_overdue(pool: ConnectionPool) -> list[tuple[str, str]]:
    """One escalation round over every overdue alert; returns (alert, nurse) pairs escalated."""
    escalated = []
    with role_connection(pool, ALERT_SERVICE_ROLE) as conn:
        overdue = conn.execute(OVERDUE_SQL, {"after": ESCALATE_AFTER_SECONDS}).fetchall()

        for alert_id, ward_id, assigned in overdue:
            target = conn.execute(
                TARGET_SQL,
                {"alert": alert_id, "ward": ward_id, "assigned": assigned, "fresh": LOCATION_FRESH_MINUTES},
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
