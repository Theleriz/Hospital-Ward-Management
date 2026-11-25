"""Corridor board (part 4): a read-only summary for the screen in the corridor.

No login: anyone who sees the screen sees the board. So the summary carries no
patient data (NFR-03): no names, no alert descriptions, no nurse names; only the
ward, its occupancy, and for each active alert its priority, how long it has been
waiting, whether it was escalated and whether staff from outside the ward was called.

Access without login is allowed only from the hospital's internal networks or from
known screens that present their secret token (decisions.md, record 15). The data
is read as the database role medbase_board, which can read nothing but this summary.
"""

import hmac
import ipaddress
from datetime import datetime
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.config import settings
from app.db import role_connection

router = APIRouter(prefix="/api/board", tags=["board"])

BOARD_ROLE = "medbase_board"
SCREEN_HEADER = "X-Board-Screen"

Network = ipaddress.IPv4Network | ipaddress.IPv6Network


class BoardAlert(BaseModel):
    priority: Literal["LOW", "HIGH", "CRITICAL"]
    status: Literal["PENDING", "ESCALATED"]
    waiting_seconds: int
    # The ward nurse did not answer in time and the alert was passed on (UC-7)
    escalated: bool
    # Staff from outside the ward's shift team was called for it
    outside_call: bool
    # Nobody on shift has been given the alert yet
    no_nurse: bool


class BoardWard(BaseModel):
    ward_id: int
    ward_name: str
    floor: int
    capacity: int
    occupied: int
    available: int
    # Most urgent first: priority, then the longest wait
    alerts: list[BoardAlert]


class BoardSummary(BaseModel):
    generated_at: datetime
    refresh_seconds: float
    wards: list[BoardWard]


WARDS_SQL = """
    SELECT "WardID", "WardName", "FloorNum", "Capacity", "CurrentOccupancy", "AvailableBeds"
    FROM "vw_WardCapacity"
    ORDER BY "FloorNum", "WardID"
"""

ALERTS_SQL = """
    SELECT "WardID", "Priority", "Status", "WaitingSeconds", "IsEscalated", "OutsideCall", "NoNurse"
    FROM "vw_CorridorAlerts"
    ORDER BY CASE "Priority" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
             "WaitingSeconds" DESC
"""


@lru_cache
def networks(value: str) -> tuple[Network, ...]:
    return tuple(ipaddress.ip_network(n.strip(), strict=False) for n in value.split(",") if n.strip())


def in_networks(address: str | None, value: str) -> bool:
    try:
        ip = ipaddress.ip_address(address or "")
    except ValueError:
        return False
    return any(ip in net for net in networks(value))


def client_address(request: Request) -> str | None:
    """The address the request really came from.

    The board's nginx puts the screen's address into X-Real-IP. The header is
    believed only when the request comes from a trusted proxy; anyone else could
    simply write a private address into it.
    """
    peer = request.client.host if request.client else None
    forwarded = request.headers.get("X-Real-IP")
    if forwarded and in_networks(peer, settings.board_trusted_proxies):
        return forwarded.strip()
    return peer


def known_screen(request: Request) -> bool:
    token = request.headers.get(SCREEN_HEADER, "")
    tokens = [t.strip() for t in settings.board_screen_tokens.split(",") if t.strip()]
    # compare_digest for every token: the time taken does not reveal how much matched
    return bool(token) and any(hmac.compare_digest(token.encode(), t.encode()) for t in tokens)


def board_access(request: Request) -> None:
    """Internal network or a known screen; otherwise 403 without any data."""
    if in_networks(client_address(request), settings.board_allowed_networks) or known_screen(request):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Этот экран не допущен к табло")


@router.get("/summary", dependencies=[Depends(board_access)])
def summary(request: Request, response: Response) -> BoardSummary:
    """Occupancy and active alerts of every ward, without patient data."""
    with role_connection(request.app.state.pool, BOARD_ROLE) as conn:
        now = conn.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0]
        ward_rows = conn.execute(WARDS_SQL).fetchall()
        alert_rows = conn.execute(ALERTS_SQL).fetchall()

    alerts: dict[int, list[BoardAlert]] = {}
    for ward_id, priority, alert_status, waiting, escalated, outside, no_nurse in alert_rows:
        alerts.setdefault(ward_id, []).append(BoardAlert(
            priority=priority, status=alert_status, waiting_seconds=waiting,
            escalated=escalated, outside_call=outside, no_nurse=no_nurse,
        ))

    # Always fresh: a cached summary would show a calm corridor during an emergency
    response.headers["Cache-Control"] = "no-store"
    return BoardSummary(
        generated_at=now,
        refresh_seconds=settings.board_refresh_seconds,
        wards=[
            BoardWard(
                ward_id=w[0], ward_name=w[1], floor=w[2], capacity=w[3], occupied=w[4], available=w[5],
                alerts=alerts.get(w[0], []),
            )
            for w in ward_rows
        ],
    )
