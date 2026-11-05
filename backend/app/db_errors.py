"""Turning database refusals into API answers.

The backend checks the business rules first; when the database still refuses
(a parallel request took the last bed, a rule only the database knows), the
procedure's message reaches the user as 409 instead of a server error.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException, status
from psycopg import errors


@contextmanager
def database_rules() -> Iterator[None]:
    try:
        yield
    except (errors.RaiseException, errors.IntegrityError) as exc:
        detail = exc.diag.message_primary or "Операция отклонена базой данных"
        raise HTTPException(status.HTTP_409_CONFLICT, f"База данных отклонила операцию: {detail}") from exc
