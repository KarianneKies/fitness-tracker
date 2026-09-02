# routers/checkins.py — Weekly check-ins (photo + weight + measurements)

import os
import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..config import PHOTOS_DIR
from ..database import get_session
from ..models import WeeklyCheckin

router = APIRouter(tags=["checkins"])


class CheckinResponse(BaseModel):
    """Response model for a weekly check-in."""
    id: int
    checkin_date: str
    photo_path: Optional[str]
    weight_kg: Optional[float]
    waist_cm: Optional[float]
    chest_cm: Optional[float]
    hips_cm: Optional[float]
    arm_cm: Optional[float]
    thigh_cm: Optional[float]
    notes: Optional[str]


def _checkin_to_response(checkin: WeeklyCheckin) -> CheckinResponse:
    """Expose photo_path as a URL under the /photos static mount."""
    return CheckinResponse(
        id=checkin.id,
        checkin_date=checkin.checkin_date.isoformat(),
        photo_path=f"/photos/{os.path.basename(checkin.photo_path)}" if checkin.photo_path else None,
        weight_kg=checkin.weight_kg,
        waist_cm=checkin.waist_cm,
        chest_cm=checkin.chest_cm,
        hips_cm=checkin.hips_cm,
        arm_cm=checkin.arm_cm,
        thigh_cm=checkin.thigh_cm,
        notes=checkin.notes,
    )


def _generate_checkin_photo_path() -> str:
    """A fresh timestamped path in PHOTOS_DIR for a check-in photo."""
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"checkin_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
    return os.path.join(PHOTOS_DIR, filename)


@router.post("/checkins", response_model=CheckinResponse)
async def create_checkin(
    checkin_date: Optional[str] = Form(None),
    weight_kg: Optional[float] = Form(None),
    waist_cm: Optional[float] = Form(None),
    chest_cm: Optional[float] = Form(None),
    hips_cm: Optional[float] = Form(None),
    arm_cm: Optional[float] = Form(None),
    thigh_cm: Optional[float] = Form(None),
    notes: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
):
    """Save a weekly check-in: optional photo, weight, measurements, notes."""
    photo_path = None
    if photo is not None and photo.filename:
        photo_path = _generate_checkin_photo_path()
        content = await photo.read()
        with open(photo_path, "wb") as f:
            f.write(content)

    with get_session() as session:
        checkin_kwargs = {
            "weight_kg": weight_kg,
            "waist_cm": waist_cm,
            "chest_cm": chest_cm,
            "hips_cm": hips_cm,
            "arm_cm": arm_cm,
            "thigh_cm": thigh_cm,
            "notes": notes,
            "photo_path": photo_path,
        }
        if checkin_date:
            try:
                checkin_kwargs["checkin_date"] = date.fromisoformat(checkin_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="checkin_date must be YYYY-MM-DD")

        db_checkin = WeeklyCheckin(**checkin_kwargs)
        session.add(db_checkin)
        session.commit()
        session.refresh(db_checkin)
        return _checkin_to_response(db_checkin)


@router.get("/checkins", response_model=List[CheckinResponse])
def get_checkins():
    """All weekly check-ins, most recent first."""
    with get_session() as session:
        checkins = session.query(WeeklyCheckin).order_by(
            WeeklyCheckin.checkin_date.desc(), WeeklyCheckin.created_at.desc()
        ).all()
        return [_checkin_to_response(c) for c in checkins]


@router.get("/checkins/{checkin_id}", response_model=CheckinResponse)
def get_checkin(checkin_id: int):
    """Get one weekly check-in."""
    with get_session() as session:
        checkin = session.query(WeeklyCheckin).filter(WeeklyCheckin.id == checkin_id).first()
        if not checkin:
            raise HTTPException(status_code=404, detail="Check-in not found")
        return _checkin_to_response(checkin)


@router.patch("/checkins/{checkin_id}", response_model=CheckinResponse)
async def update_checkin(
    checkin_id: int,
    checkin_date: Optional[str] = Form(None),
    weight_kg: Optional[float] = Form(None),
    waist_cm: Optional[float] = Form(None),
    chest_cm: Optional[float] = Form(None),
    hips_cm: Optional[float] = Form(None),
    arm_cm: Optional[float] = Form(None),
    thigh_cm: Optional[float] = Form(None),
    notes: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
):
    """
    Update a weekly check-in. A new photo replaces the old file; omitted
    fields are left unchanged.
    """
    with get_session() as session:
        db_checkin = session.query(WeeklyCheckin).filter(WeeklyCheckin.id == checkin_id).first()
        if not db_checkin:
            raise HTTPException(status_code=404, detail="Check-in not found")

        if checkin_date:
            try:
                db_checkin.checkin_date = date.fromisoformat(checkin_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="checkin_date must be YYYY-MM-DD")
        if weight_kg is not None:
            db_checkin.weight_kg = weight_kg
        if waist_cm is not None:
            db_checkin.waist_cm = waist_cm
        if chest_cm is not None:
            db_checkin.chest_cm = chest_cm
        if hips_cm is not None:
            db_checkin.hips_cm = hips_cm
        if arm_cm is not None:
            db_checkin.arm_cm = arm_cm
        if thigh_cm is not None:
            db_checkin.thigh_cm = thigh_cm
        if notes is not None:
            db_checkin.notes = notes

        if photo is not None and photo.filename:
            new_path = _generate_checkin_photo_path()
            content = await photo.read()
            with open(new_path, "wb") as f:
                f.write(content)

            old_path = db_checkin.photo_path
            db_checkin.photo_path = new_path
            if old_path:
                try:
                    os.remove(old_path)
                except OSError:
                    pass

        session.commit()
        session.refresh(db_checkin)
        return _checkin_to_response(db_checkin)


@router.delete("/checkins/{checkin_id}")
def delete_checkin(checkin_id: int):
    """Delete a weekly check-in and its photo file, if any."""
    with get_session() as session:
        checkin = session.query(WeeklyCheckin).filter(WeeklyCheckin.id == checkin_id).first()
        if not checkin:
            raise HTTPException(status_code=404, detail="Check-in not found")

        if checkin.photo_path:
            try:
                os.remove(checkin.photo_path)
            except OSError:
                pass

        session.delete(checkin)
        session.commit()
        return {"message": "Check-in deleted successfully"}
