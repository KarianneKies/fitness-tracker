# routers/exercises.py — Logged-exercise history, custom names, workout suggestion, knee list

import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_

from ..database import get_session
from ..models import Workout, Exercise, ExerciseSet, CustomExercise, KneeExercise
from ..workout_suggestion import suggest_workout
from ..exercise_guide import find_guide

router = APIRouter(tags=["exercises"])


class CustomExerciseCreate(BaseModel):
    """Request body for creating a custom exercise."""
    name: str


class KneeExerciseCreate(BaseModel):
    """Request model for adding an entry to the knee-strengthening list."""
    name: str


class SuggestedExerciseResponse(BaseModel):
    """Response model for one exercise in a proposed workout."""
    name: str
    muscle_group: str
    reason: str


def _base_exercise_name(name: str) -> str:
    """
    Strip a trailing equipment qualifier like " (Barbell)" so e.g. "Romanian
    Deadlift" and "Romanian Deadlift (Barbell)" are treated as the same
    exercise when grouping logged history.
    """
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()


@router.get("/exercises/logged")
def list_logged_exercises():
    """
    Exercises actually logged in a workout, merged by base name (stripping
    equipment qualifiers), sorted by how many times each has been logged.
    """
    with get_session() as session:
        rows = session.query(Exercise.name).all()

        groups = {}
        for (raw_name,) in rows:
            base = _base_exercise_name(raw_name)
            key = base.lower()
            if key not in groups:
                groups[key] = {"name": base, "count": 0, "variants": set()}
            groups[key]["count"] += 1
            groups[key]["variants"].add(raw_name)

        result = [
            {"name": g["name"], "count": g["count"], "variants": sorted(g["variants"])}
            for g in groups.values()
        ]
        result.sort(key=lambda g: (-g["count"], g["name"].lower()))
        return result


@router.get("/exercises/names")
def list_exercise_names():
    """Distinct exercise names used across all logged workouts, alphabetical."""
    with get_session() as session:
        rows = session.query(Exercise.name).distinct().order_by(Exercise.name).all()
        return [r[0] for r in rows]


@router.get("/exercises/previous")
def get_previous_exercise_sets(name: str, exclude_workout_id: Optional[int] = None):
    """
    The sets logged for an exercise the last time it was done, so the picker
    can show "Previous" reference values. Warmup sets (note="Warmup", from
    imported history) are left out; dropsets and to-failure sets are kept.
    """
    with get_session() as session:
        query = session.query(Exercise).join(Workout, Exercise.workout_id == Workout.id).filter(
            func.lower(Exercise.name) == name.strip().lower()
        )
        if exclude_workout_id is not None:
            query = query.filter(Exercise.workout_id != exclude_workout_id)

        previous_exercise = query.order_by(Workout.started_at.desc(), Exercise.id.desc()).first()
        if not previous_exercise:
            return {"workout_id": None, "sets": []}

        sets = session.query(ExerciseSet).filter(
            ExerciseSet.exercise_id == previous_exercise.id,
            or_(ExerciseSet.note != "Warmup", ExerciseSet.note.is_(None)),
        ).order_by(ExerciseSet.order).all()

        return {
            "workout_id": previous_exercise.workout_id,
            "sets": [
                {
                    "order": s.order,
                    "weight_kg": s.weight_kg,
                    "reps": s.reps,
                    "hold_seconds": s.hold_seconds,
                    "to_failure": s.to_failure,
                }
                for s in sets
            ],
        }


@router.get("/exercises/progress")
def get_exercise_progress(name: str):
    """
    Top set weight per day for an exercise, in date order, for the Progress
    tab's strength chart. Matched by base name so variants combine into one
    trend line.
    """
    target_base = _base_exercise_name(name).strip().lower()

    with get_session() as session:
        rows = session.query(Exercise, Workout.started_at).join(
            Workout, Exercise.workout_id == Workout.id
        ).order_by(Workout.started_at).all()

        by_date = {}
        for exercise, started_at in rows:
            if _base_exercise_name(exercise.name).strip().lower() != target_base:
                continue

            top_set = session.query(ExerciseSet).filter(
                ExerciseSet.exercise_id == exercise.id,
                ExerciseSet.weight_kg.isnot(None),
            ).order_by(ExerciseSet.weight_kg.desc()).first()
            if not top_set:
                continue

            date_key = started_at.date().isoformat()
            if date_key not in by_date or top_set.weight_kg > by_date[date_key]:
                by_date[date_key] = top_set.weight_kg

        return [{"date": d, "weight_kg": w} for d, w in sorted(by_date.items())]


@router.get("/exercises/guide")
def get_exercise_guide(name: str):
    """
    How-to-perform guide for an exercise: step-by-step instructions, target
    muscles, equipment, and a GIF URL (loaded by the client from a CDN).
    `matched` is False when no dataset entry is a close enough fit.
    """
    guide = find_guide(name)
    return guide or {"matched": False, "name": name}


@router.get("/exercises/history")
def get_exercise_history(name: str):
    """
    Every time this exercise was logged, most recent first, matched by base
    name (equipment qualifiers stripped) so variants combine. Each entry has
    the workout it belongs to and every set.
    """
    target_base = _base_exercise_name(name).strip().lower()

    with get_session() as session:
        rows = (
            session.query(Exercise, Workout)
            .join(Workout, Exercise.workout_id == Workout.id)
            .order_by(Workout.started_at.desc(), Exercise.id.desc())
            .all()
        )

        history = []
        for exercise, workout in rows:
            if _base_exercise_name(exercise.name).strip().lower() != target_base:
                continue
            sets = session.query(ExerciseSet).filter(
                ExerciseSet.exercise_id == exercise.id
            ).order_by(ExerciseSet.order).all()
            history.append({
                "workout_id": workout.id,
                "workout_name": workout.name,
                "date": workout.started_at.date().isoformat(),
                "exercise_name": exercise.name,
                "sets": [
                    {
                        "order": s.order,
                        "reps": s.reps,
                        "weight_kg": s.weight_kg,
                        "hold_seconds": s.hold_seconds,
                        "to_failure": s.to_failure,
                    }
                    for s in sets
                ],
            })
        return history


@router.get("/exercises/custom")
def list_custom_exercises():
    """User-added custom exercise names, most recently added first."""
    with get_session() as session:
        rows = session.query(CustomExercise).order_by(CustomExercise.created_at.desc()).all()
        return [{"id": r.id, "name": r.name} for r in rows]


@router.post("/exercises/custom")
def create_custom_exercise(payload: CustomExerciseCreate):
    """
    Persist a user-typed exercise name for the picker. Idempotent by name
    (case-insensitive).
    """
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Exercise name cannot be empty")

    with get_session() as session:
        existing = session.query(CustomExercise).filter(
            func.lower(CustomExercise.name) == name.lower()
        ).first()
        if existing:
            return {"id": existing.id, "name": existing.name}

        custom_exercise = CustomExercise(name=name)
        session.add(custom_exercise)
        session.commit()
        session.refresh(custom_exercise)
        return {"id": custom_exercise.id, "name": custom_exercise.name}


@router.get("/suggest-workout", response_model=List[SuggestedExerciseResponse])
def get_suggested_workout(split: Optional[str] = None):
    """
    Propose an all-upper or all-lower workout for the "Recommended Workout"
    screen. `split` = "upper"/"lower" to choose; omit to auto-decide.
    """
    if split is not None and split.lower() not in ("upper", "lower"):
        raise HTTPException(status_code=400, detail="split must be 'upper' or 'lower'")

    with get_session() as session:
        return suggest_workout(session, split=split)


@router.get("/knee-exercises")
def list_knee_exercises():
    """The user's knee-strengthening list, most recently added first."""
    with get_session() as session:
        rows = session.query(KneeExercise).order_by(KneeExercise.created_at.desc()).all()
        return [{"id": r.id, "name": r.name} for r in rows]


@router.post("/knee-exercises")
def create_knee_exercise(payload: KneeExerciseCreate):
    """Add an entry to the knee-strengthening list. Idempotent by name."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Exercise name cannot be empty")

    with get_session() as session:
        existing = session.query(KneeExercise).filter(
            func.lower(KneeExercise.name) == name.lower()
        ).first()
        if existing:
            return {"id": existing.id, "name": existing.name}

        knee_exercise = KneeExercise(name=name)
        session.add(knee_exercise)
        session.commit()
        session.refresh(knee_exercise)
        return {"id": knee_exercise.id, "name": knee_exercise.name}


@router.delete("/knee-exercises/{knee_exercise_id}")
def delete_knee_exercise(knee_exercise_id: int):
    """Remove an entry from the knee-strengthening list."""
    with get_session() as session:
        db_entry = session.query(KneeExercise).filter(KneeExercise.id == knee_exercise_id).first()
        if not db_entry:
            raise HTTPException(status_code=404, detail="Knee exercise not found")

        session.delete(db_entry)
        session.commit()
        return {"message": "Knee exercise deleted successfully"}
