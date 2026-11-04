"""Login, logout and the current user (UC-6, Lab 05: badge with PIN)."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.auth import SESSION_KEY, User, authenticate, current_user, login_throttle

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    # The badge reader types the badge ID like a keyboard
    badge_id: str = Field(min_length=1, max_length=32)
    pin: str = Field(pattern=r"^\d{4,8}$")


@router.post("/login")
def login(body: LoginRequest, request: Request) -> User:
    badge_id = body.badge_id.strip()

    locked_for = login_throttle.seconds_locked(badge_id)
    if locked_for:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много неверных попыток, попробуйте позже",
            headers={"Retry-After": str(locked_for)},
        )

    with request.app.state.pool.connection() as conn:
        user = authenticate(conn, badge_id, body.pin)

    if user is None:
        login_throttle.record_failure(badge_id)
        # Same answer for an unknown badge and a wrong PIN
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный бейдж или PIN")

    login_throttle.record_success(badge_id)
    request.session.clear()
    request.session[SESSION_KEY] = user.model_dump(mode="json")
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me")
def me(user: User = Depends(current_user)) -> User:
    return user
