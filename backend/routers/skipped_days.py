# routers/skipped_days.py — Days the user deliberately did not track food

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_session
from ..models import DailySkippedDay

router = APIRouter(tags=["skipped-days"])


class SkippedDayResponse(BaseModel):
    """Response model for a skipped day."""
    id: Optional[int]
    skip_date: str
    created_at: Optional[str]


class SkippedDayCreate(BaseModel):
    """Request model for marking a day skipped (YYYY-MM-DD)."""
    skip_date: str


def _to_response(row: DailySkippedDay) -> SkippedDayResponse:
    return SkippedDayResponse(
        id=row.id,
        skip_date=row.skip_date.isoformat(),
        created_at=row.created_at.isoformat() if row.created_at else None,
    )


@router.get("/skipped-days", response_model=List[SkippedDayResponse])
def get_skipped_days():
    """All skipped days, most recent first."""
    with get_session() as session:
        rows = session.query(DailySkippedDay).order_by(DailySkippedDay.skip_date.desc()).all()
        return [_to_response(r) for r in rows]


@router.post("/skipped-days", response_model=SkippedDayResponse)
def create_skipped_day(skipped_day: SkippedDayCreate):
    """
    Mark any calendar date (today or in the past) as skipped for food
    tracking. Idempotent: an already-skipped date returns the existing row.
    """
    with get_session() as session:
        try:
            skip_date = date.fromisoformat(skipped_day.skip_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="skip_date must be YYYY-MM-DD")

        row = session.query(DailySkippedDay).filter(
            DailySkippedDay.skip_date == skip_date
        ).first()
        if row is None:
            row = DailySkippedDay(skip_date=skip_date)
            session.add(row)
            session.commit()
            session.refresh(row)
        return _to_response(row)


@router.delete("/skipped-days/{skip_date}")
def delete_skipped_day(skip_date: str):
    """Un-skip a date. Idempotent: a no-op if the date wasn't skipped."""
    with get_session() as session:
        try:
            skip_date_obj = date.fromisoformat(skip_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="skip_date must be YYYY-MM-DD")

        row = session.query(DailySkippedDay).filter(
            DailySkippedDay.skip_date == skip_date_obj
        ).first()
        if row is not None:
            session.delete(row)
            session.commit()
        return {"message": "Skipped day removed successfully"}
