# routers/workouts.py — Workout / exercise / set CRUD

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_session
from ..models import Workout, Exercise, ExerciseSet
from ..muscle_groups import guess_muscle_group

router = APIRouter(tags=["workouts"])


# ========== Models ==========
class WorkoutCreate(BaseModel):
    """Request model for starting a new workout."""
    name: Optional[str] = None
    notes: Optional[str] = None


class ExerciseSetData(BaseModel):
    """Request model for an exercise set."""
    id: Optional[int] = None
    order: int
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    hold_seconds: Optional[int] = None
    to_failure: bool = False
    rest_seconds: Optional[int] = None
    note: Optional[str] = None


class ExerciseCreate(BaseModel):
    """Request model for adding an exercise to a workout."""
    id: Optional[int] = None
    name: str
    order: int
    sets: Optional[List[ExerciseSetData]] = None


class WorkoutUpdate(BaseModel):
    """Request model for updating a workout."""
    name: Optional[str] = None
    finished_at: Optional[datetime] = None
    notes: Optional[str] = None
    exercises: Optional[List[ExerciseCreate]] = None


class ExerciseSetResponse(BaseModel):
    """Response model for an exercise set."""
    id: int
    order: int
    reps: Optional[int]
    weight_kg: Optional[float]
    hold_seconds: Optional[int]
    to_failure: bool
    rest_seconds: Optional[int]
    note: Optional[str]


class ExerciseResponse(BaseModel):
    """Response model for an exercise with its sets."""
    id: int
    workout_id: int
    name: str
    order: int
    muscle_group: Optional[str]
    sets: List[ExerciseSetResponse]


class WorkoutResponse(BaseModel):
    """Response model for a workout."""
    id: int
    started_at: str
    finished_at: Optional[str]
    duration_seconds: Optional[int]
    name: Optional[str]
    notes: Optional[str]
    exercises: List[ExerciseResponse] = []


class WorkoutDetailResponse(WorkoutResponse):
    """Response model for a workout with all exercises and sets."""
    exercises: List[ExerciseResponse]


# ========== Serialization ==========
def _serialize_exercises(session, workout_id: int) -> List[ExerciseResponse]:
    """Load a workout's exercises (ordered) with their sets (ordered)."""
    exercises = session.query(Exercise).filter(
        Exercise.workout_id == workout_id
    ).order_by(Exercise.order).all()

    result = []
    for exercise in exercises:
        sets = session.query(ExerciseSet).filter(
            ExerciseSet.exercise_id == exercise.id
        ).order_by(ExerciseSet.order).all()
        result.append(ExerciseResponse(
            id=exercise.id,
            workout_id=exercise.workout_id,
            name=exercise.name,
            order=exercise.order,
            muscle_group=exercise.muscle_group,
            sets=[
                ExerciseSetResponse(
                    id=s.id, order=s.order, reps=s.reps, weight_kg=s.weight_kg,
                    hold_seconds=s.hold_seconds, to_failure=s.to_failure,
                    rest_seconds=s.rest_seconds, note=s.note,
                )
                for s in sets
            ],
        ))
    return result


def _serialize_workout(session, workout: Workout) -> WorkoutDetailResponse:
    """Build the full workout response (with nested exercises and sets)."""
    return WorkoutDetailResponse(
        id=workout.id,
        started_at=workout.started_at.isoformat(),
        finished_at=workout.finished_at.isoformat() if workout.finished_at else None,
        duration_seconds=workout.duration_seconds,
        name=workout.name,
        notes=workout.notes,
        exercises=_serialize_exercises(session, workout.id),
    )


# ========== Endpoints ==========
@router.post("/workouts", response_model=WorkoutResponse)
def start_workout(workout: WorkoutCreate):
    """Start a new workout (started_at = now, duration = null)."""
    with get_session() as session:
        db_workout = Workout(
            started_at=datetime.utcnow(),
            name=workout.name,
            notes=workout.notes,
        )
        session.add(db_workout)
        session.commit()
        session.refresh(db_workout)

        return WorkoutResponse(
            id=db_workout.id,
            started_at=db_workout.started_at.isoformat(),
            finished_at=None,
            duration_seconds=None,
            name=db_workout.name,
            notes=db_workout.notes,
        )


@router.get("/workouts", response_model=List[WorkoutResponse])
def get_workouts():
    """Get all workouts, most recent first, with their exercises and sets."""
    with get_session() as session:
        workouts = session.query(Workout).order_by(Workout.started_at.desc()).all()
        return [_serialize_workout(session, w) for w in workouts]


@router.get("/workouts/{workout_id}", response_model=WorkoutDetailResponse)
def get_workout(workout_id: int):
    """Get one workout with all exercises and sets."""
    with get_session() as session:
        workout = session.query(Workout).filter(Workout.id == workout_id).first()
        if not workout:
            raise HTTPException(status_code=404, detail="Workout not found")
        return _serialize_workout(session, workout)


@router.patch("/workouts/{workout_id}", response_model=WorkoutDetailResponse)
def update_workout(workout_id: int, workout_update: WorkoutUpdate):
    """
    Update a workout: finish it (sets finished_at and computes
    duration_seconds), change name/notes, or add/edit exercises and sets
    via nested data.
    """
    with get_session() as session:
        db_workout = session.query(Workout).filter(Workout.id == workout_id).first()
        if not db_workout:
            raise HTTPException(status_code=404, detail="Workout not found")

        if workout_update.finished_at is not None:
            db_workout.finished_at = workout_update.finished_at
            start_time = db_workout.started_at.replace(tzinfo=None)
            end_time = workout_update.finished_at.replace(tzinfo=None)
            db_workout.duration_seconds = int((end_time - start_time).total_seconds())

        if workout_update.name is not None:
            db_workout.name = workout_update.name
        if workout_update.notes is not None:
            db_workout.notes = workout_update.notes

        session.commit()

        if workout_update.exercises is not None:
            for exercise_data in workout_update.exercises:
                db_exercise = None
                if exercise_data.id is not None:
                    db_exercise = session.query(Exercise).filter(
                        Exercise.id == exercise_data.id,
                        Exercise.workout_id == workout_id,
                    ).first()

                if db_exercise is None:
                    # Fall back to matching by order, for callers that don't send an id
                    db_exercise = session.query(Exercise).filter(
                        Exercise.workout_id == workout_id,
                        Exercise.order == exercise_data.order,
                    ).first()

                if db_exercise is None:
                    db_exercise = Exercise(
                        workout_id=workout_id,
                        name=exercise_data.name,
                        order=exercise_data.order,
                        muscle_group=guess_muscle_group(exercise_data.name),
                    )
                    session.add(db_exercise)
                else:
                    db_exercise.name = exercise_data.name
                    db_exercise.order = exercise_data.order
                    db_exercise.muscle_group = guess_muscle_group(exercise_data.name)
                session.commit()
                session.refresh(db_exercise)

                if exercise_data.sets is not None:
                    kept_set_ids = set()
                    for set_data in exercise_data.sets:
                        db_set = None
                        if set_data.id is not None:
                            db_set = session.query(ExerciseSet).filter(
                                ExerciseSet.id == set_data.id,
                                ExerciseSet.exercise_id == db_exercise.id,
                            ).first()

                        if db_set is None:
                            db_set = ExerciseSet(exercise_id=db_exercise.id)
                            session.add(db_set)

                        db_set.order = set_data.order
                        db_set.reps = set_data.reps
                        db_set.weight_kg = set_data.weight_kg
                        db_set.hold_seconds = set_data.hold_seconds
                        db_set.to_failure = set_data.to_failure
                        db_set.rest_seconds = set_data.rest_seconds
                        db_set.note = set_data.note
                        session.commit()
                        session.refresh(db_set)
                        kept_set_ids.add(db_set.id)

                    # Remove sets no longer present (e.g. deleted client-side)
                    session.query(ExerciseSet).filter(
                        ExerciseSet.exercise_id == db_exercise.id,
                        ExerciseSet.id.not_in(kept_set_ids),
                    ).delete(synchronize_session=False)
                    session.commit()

        session.refresh(db_workout)
        return _serialize_workout(session, db_workout)


@router.delete("/workouts/{workout_id}")
def delete_workout(workout_id: int):
    """Delete a workout and all its exercises/sets."""
    with get_session() as session:
        workout = session.query(Workout).filter(Workout.id == workout_id).first()
        if not workout:
            raise HTTPException(status_code=404, detail="Workout not found")

        session.query(ExerciseSet).filter(
            ExerciseSet.exercise_id.in_(
                session.query(Exercise.id).filter(Exercise.workout_id == workout_id)
            )
        ).delete(synchronize_session=False)
        session.query(Exercise).filter(
            Exercise.workout_id == workout_id
        ).delete(synchronize_session=False)
        session.delete(workout)
        session.commit()

        return {"message": "Workout deleted successfully"}


@router.delete("/workouts/{workout_id}/exercises/{exercise_id}")
def delete_exercise(workout_id: int, exercise_id: int):
    """Remove a single exercise (and its sets) from a workout, by its id."""
    with get_session() as session:
        exercise = session.query(Exercise).filter(
            Exercise.id == exercise_id,
            Exercise.workout_id == workout_id,
        ).first()
        if not exercise:
            raise HTTPException(status_code=404, detail="Exercise not found")

        session.query(ExerciseSet).filter(
            ExerciseSet.exercise_id == exercise_id
        ).delete(synchronize_session=False)
        session.delete(exercise)
        session.commit()

        return {"message": "Exercise deleted successfully"}
