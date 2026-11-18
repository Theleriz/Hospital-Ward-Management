"""Login, logout and the current user (UC-6, Lab 05: badge with PIN)."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from psycopg import Error as DatabaseError
from psycopg_pool import PoolTimeout

from app.auth import SESSION_KEY, User, authenticate, current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    # The badge reader types the badge ID like a keyboard
    badge_id: str = Field(min_length=1, max_length=32)
    pin: str = Field(pattern=r"^[0-9]{4,8}$")

    @field_validator('badge_id')
    @classmethod
    def badge_is_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Бейдж не должен быть пустым')
        return value


@router.post("/login")
def login(body: LoginRequest, request: Request) -> User:
    badge_id = body.badge_id.strip()

    try:
        with request.app.state.pool.connection() as conn:
            result = authenticate(conn, badge_id, body.pin)
        # The context above committed the failed-attempt counter too.
    except (DatabaseError, PoolTimeout):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, 'Вход временно недоступен') from None

    if result.retry_after:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много неверных попыток, попробуйте позже",
            headers={"Retry-After": str(result.retry_after)},
        )

    if result.user is None:
        # Same answer for an unknown badge and a wrong PIN
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный бейдж или PIN")

    request.session.clear()
    request.session[SESSION_KEY] = result.user.model_dump(mode="json")
    return result.user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me")
def me(user: User = Depends(current_user)) -> User:
    return user
