"""Ward occupancy board (UC-4): every signed-in role sees it, without patient data."""

from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from app.auth import user_db

router = APIRouter(prefix="/api/wards", tags=["wards"])


class WardCapacity(BaseModel):
    ward_id: int
    ward_name: str
    floor: int
    ward_type: str
    capacity: int
    occupied: int
    available: int


WARD_CAPACITY_SQL = """
    SELECT "WardID", "WardName", "FloorNum", "WardType", "Capacity", "CurrentOccupancy", "AvailableBeds"
    FROM "vw_WardCapacity"
"""


def ward_from_row(row) -> WardCapacity:
    return WardCapacity(
        ward_id=row[0], ward_name=row[1], floor=row[2], ward_type=row[3],
        capacity=row[4], occupied=row[5], available=row[6],
    )


def get_ward(conn: Connection, ward_id: int) -> WardCapacity | None:
    row = conn.execute(WARD_CAPACITY_SQL + ' WHERE "WardID" = %s', (ward_id,)).fetchone()
    return ward_from_row(row) if row else None


@router.get("")
def list_wards(conn: Connection = Depends(user_db)) -> list[WardCapacity]:
    rows = conn.execute(WARD_CAPACITY_SQL + ' ORDER BY "WardID"').fetchall()
    return [ward_from_row(row) for row in rows]
