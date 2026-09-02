# main.py — FastAPI application for Fitness Tracker

"""
FastAPI backend for the local fitness and nutrition tracker.

App wiring only: middleware, startup, the validation-error handler, the
static mounts for the PWA and saved photos, and the per-domain routers.
The endpoints themselves live in backend/routers/:

- workouts.py      workouts + their exercises/sets
- exercises.py     logged-exercise history, custom names, suggest-workout, knee list
- foods.py         food reference search, label scan, custom products, servings, food photo
- meals.py         meals, the by-day nutrition diary, meal templates
- checkins.py      weekly check-ins (photo + weight + measurements)
- goals.py         the single active goal
- skipped_days.py  days deliberately not tracked
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import FRONTEND_DIR, PHOTOS_DIR
from .database import create_db_and_tables, get_session
from .workout_suggestion import seed_default_knee_exercises
from .routers import (
    workouts, exercises, foods, meals, checkins, goals, skipped_days, evaluation,
)


app = FastAPI(
    title="Fitness Tracker API",
    description="Backend API for the local fitness and nutrition tracking app",
    version="0.1.0",
)


@app.on_event("startup")
def on_startup():
    """Create tables, run data migrations, and seed default data."""
    create_db_and_tables()
    with get_session() as session:
        seed_default_knee_exercises(session)


# CORS. The PWA is served from this same app (StaticFiles at "/") and calls
# it same-origin, so CORS isn't needed for normal use - this only exists so
# the API can be poked from a browser devtools console or a separate dev
# server. `allow_credentials` stays False: with it True the "*" origin is
# invalid per the CORS spec and browsers reject every response.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
def log_validation_errors(request: Request, exc: RequestValidationError):
    """
    Default 422 behaviour, plus a server-side log line for the two upload
    endpoints - a real device has hit "Field required" on /foods/label-scan
    with no obvious client cause, and this records exactly what arrived.
    """
    if request.url.path in ("/foods/label-scan", "/meals/photo"):
        content_type = request.headers.get("content-type", "<missing>")
        content_length = request.headers.get("content-length", "<missing>")
        user_agent = request.headers.get("user-agent", "<missing>")
        print(
            f"422 on {request.url.path} from {request.client.host if request.client else '?'}: "
            f"errors={exc.errors()} content-type={content_type!r} content-length={content_length!r} "
            f"user-agent={user_agent!r}"
        )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/health")
def health_check():
    """Health check - returns status OK."""
    return {"status": "ok", "service": "fitness-tracker-api"}


for _router in (
    workouts, exercises, foods, meals, checkins, goals, skipped_days, evaluation,
):
    app.include_router(_router.router)


# Saved photos (meal + check-in) - mounted before the "/" frontend catch-all
os.makedirs(PHOTOS_DIR, exist_ok=True)
app.mount("/photos", StaticFiles(directory=PHOTOS_DIR), name="photos")

# The PWA itself
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
