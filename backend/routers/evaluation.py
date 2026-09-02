# routers/evaluation.py — Daily / weekly nutrition + training evaluation

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..database import get_session
from ..evaluation import evaluate_day, evaluate_week

router = APIRouter(tags=["evaluation"])


def _parse(d: Optional[str]) -> Optional[date]:
    if not d:
        return None
    try:
        return date.fromisoformat(d)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")


@router.get("/evaluation/daily")
def daily_evaluation(day: Optional[str] = None):
    """
    Evaluate one day's nutrition and training against the active goal.
    `day` defaults to today (YYYY-MM-DD).
    """
    with get_session() as session:
        return evaluate_day(session, _parse(day))


@router.get("/evaluation/weekly")
def weekly_evaluation(week_of: Optional[str] = None):
    """
    Evaluate the calendar week (Mon-Sun) containing `week_of` (any date in
    that week; defaults to today) against the active goal.
    """
    with get_session() as session:
        return evaluate_week(session, _parse(week_of))
