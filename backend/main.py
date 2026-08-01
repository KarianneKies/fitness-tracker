# main.py — FastAPI application for Fitness Tracker

"""
FastAPI backend for the Fitness Tracker application.

Endpoints:
- GET /health: Health check (returns status OK)
- POST /workouts: Start a new workout
- GET /workouts: List all workouts (most recent first)
- GET /workouts/{id}: Get one workout with all exercises and sets
- PATCH /workouts/{id}: Update a workout (finish, add/edit exercises/sets)
- DELETE /workouts/{id}: Delete a workout
- Static file mount for frontend
"""

from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import FRONTEND_DIR
from database import create_db_and_tables, get_session
from models import Workout, Exercise, ExerciseSet


# Create FastAPI app
app = FastAPI(
    title="Fitness Tracker API",
    description="Backend API for the local fitness and nutrition tracking app",
    version="0.1.0"
)


@app.on_event("startup")
async def on_startup():
    """
    Initialize database tables on application startup.
    """
    create_db_and_tables()


# CORS middleware (local development only)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== Workout Models ==========
class WorkoutCreate(BaseModel):
    """Request model for starting a new workout."""
    notes: Optional[str] = None


class WorkoutUpdate(BaseModel):
    """Request model for updating a workout."""
    finished_at: Optional[datetime] = None
    notes: Optional[str] = None
    exercises: Optional[List['ExerciseCreate']] = None


class ExerciseSetData(BaseModel):
    """Request model for an exercise set."""
    order: int
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    to_failure: bool = False
    rest_seconds: Optional[int] = None
    note: Optional[str] = None


class ExerciseCreate(BaseModel):
    """Request model for adding an exercise to a workout."""
    name: str
    order: int
    sets: Optional[List[ExerciseSetData]] = None


class ExerciseSetCreate(BaseModel):
    """Request model for adding a set to an exercise."""
    order: int
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    to_failure: bool = False
    rest_seconds: Optional[int] = None
    note: Optional[str] = None


class ExerciseSetResponse(BaseModel):
    """Response model for an exercise set."""
    id: int
    order: int
    reps: Optional[int]
    weight_kg: Optional[float]
    to_failure: bool
    rest_seconds: Optional[int]
    note: Optional[str]


class ExerciseResponse(BaseModel):
    """Response model for an exercise with its sets."""
    id: int
    workout_id: int
    name: str
    order: int
    sets: List[ExerciseSetResponse]


class WorkoutResponse(BaseModel):
    """Response model for a workout."""
    id: int
    started_at: str
    finished_at: Optional[str]
    duration_seconds: Optional[int]
    notes: Optional[str]


class WorkoutDetailResponse(BaseModel):
    """Response model for a workout with all exercises and sets."""
    id: int
    started_at: str
    finished_at: Optional[str]
    duration_seconds: Optional[int]
    notes: Optional[str]
    exercises: List[ExerciseResponse]


# ========== Workout Endpoints ==========
@app.get("/health")
async def health_check():
    """
    Health check endpoint.
    
    Returns:
        dict: Status indicating the API is running
    """
    return {"status": "ok", "service": "fitness-tracker-api"}


@app.post("/workouts", response_model=WorkoutResponse)
async def start_workout(workout: WorkoutCreate):
    """
    Start a new workout.
    
    Creates a workout with started_at = now and duration_seconds = null.
    
    Args:
        workout: WorkoutCreate model with optional notes
        
    Returns:
        WorkoutResponse: The created workout record
    """
    with get_session() as session:
        db_workout = Workout(
            started_at=datetime.utcnow(),
            notes=workout.notes
        )
        session.add(db_workout)
        session.commit()
        session.refresh(db_workout)
        
        return WorkoutResponse(
            id=db_workout.id,
            started_at=db_workout.started_at.isoformat(),
            finished_at=None,
            duration_seconds=None,
            notes=db_workout.notes
        )


@app.get("/workouts", response_model=List[WorkoutResponse])
async def get_workouts():
    """
    Get all workouts, most recent first.
    
    Returns:
        List[WorkoutResponse]: List of all workouts sorted by start time (newest first)
    """
    with get_session() as session:
        workouts = session.query(Workout).order_by(Workout.started_at.desc()).all()
        
        return [
            WorkoutResponse(
                id=workout.id,
                started_at=workout.started_at.isoformat(),
                finished_at=workout.finished_at.isoformat() if workout.finished_at else None,
                duration_seconds=workout.duration_seconds,
                notes=workout.notes
            )
            for workout in workouts
        ]


@app.get("/workouts/{workout_id}", response_model=WorkoutDetailResponse)
async def get_workout(workout_id: int):
    """
    Get one workout with all exercises and sets.
    
    Args:
        workout_id: The ID of the workout to retrieve
        
    Returns:
        WorkoutDetailResponse: The workout with all nested exercises and sets
    """
    with get_session() as session:
        workout = session.query(Workout).filter(Workout.id == workout_id).first()
        if not workout:
            raise HTTPException(status_code=404, detail="Workout not found")
        
        exercises = session.query(Exercise).filter(
            Exercise.workout_id == workout_id
        ).order_by(Exercise.order).all()
        
        exercises_list = []
        for exercise in exercises:
            sets = session.query(ExerciseSet).filter(
                ExerciseSet.exercise_id == exercise.id
            ).order_by(ExerciseSet.order).all()
            
            exercises_list.append(ExerciseResponse(
                id=exercise.id,
                workout_id=exercise.workout_id,
                name=exercise.name,
                order=exercise.order,
                sets=[
                    ExerciseSetResponse(
                        id=s.id,
                        order=s.order,
                        reps=s.reps,
                        weight_kg=s.weight_kg,
                        to_failure=s.to_failure,
                        rest_seconds=s.rest_seconds,
                        note=s.note
                    )
                    for s in sets
                ]
            ))
        
        return WorkoutDetailResponse(
            id=workout.id,
            started_at=workout.started_at.isoformat(),
            finished_at=workout.finished_at.isoformat() if workout.finished_at else None,
            duration_seconds=workout.duration_seconds,
            notes=workout.notes,
            exercises=exercises_list
        )


@app.patch("/workouts/{workout_id}", response_model=WorkoutResponse)
async def update_workout(workout_id: int, workout_update: WorkoutUpdate):
    """
    Update a workout.
    
    Can finish the workout (set finished_at and compute duration_seconds),
    update notes, or add/edit exercises and sets via nested data.
    
    Args:
        workout_id: The ID of the workout to update
        workout_update: WorkoutUpdate model with new data
        
    Returns:
        WorkoutResponse: The updated workout record
    """
    from typing import Dict
    
    with get_session() as session:
        db_workout = session.query(Workout).filter(Workout.id == workout_id).first()
        if not db_workout:
            raise HTTPException(status_code=404, detail="Workout not found")
        
        # Update basic fields
        if workout_update.finished_at is not None:
            db_workout.finished_at = workout_update.finished_at
            # Compute duration in seconds
            start_time = db_workout.started_at.replace(tzinfo=None)
            end_time = workout_update.finished_at.replace(tzinfo=None)
            db_workout.duration_seconds = int((end_time - start_time).total_seconds())
        
        if workout_update.notes is not None:
            db_workout.notes = workout_update.notes
        
        session.commit()
        
        # Handle adding exercises if provided
        if workout_update.exercises is not None:
            for exercise_data in workout_update.exercises:
                # Check if exercise already exists (by checking name and order)
                existing_exercise = session.query(Exercise).filter(
                    Exercise.workout_id == workout_id,
                    Exercise.order == exercise_data.order
                ).first()
                
                if not existing_exercise:
                    # Create new exercise
                    db_exercise = Exercise(
                        workout_id=workout_id,
                        name=exercise_data.name,
                        order=exercise_data.order
                    )
                    session.add(db_exercise)
                    session.commit()
                    session.refresh(db_exercise)
                    
                    # Also add sets for this exercise if provided
                    if hasattr(exercise_data, 'sets') and exercise_data.sets:
                        for set_data in exercise_data.sets:
                            db_set = ExerciseSet(
                                exercise_id=db_exercise.id,
                                order=set_data.order,
                                reps=set_data.reps,
                                weight_kg=set_data.weight_kg,
                                to_failure=set_data.to_failure,
                                rest_seconds=set_data.rest_seconds,
                                note=set_data.note
                            )
                            session.add(db_set)
                        session.commit()
        
        # Refresh workout with final state
        session.refresh(db_workout)
        
        return WorkoutResponse(
            id=db_workout.id,
            started_at=db_workout.started_at.isoformat(),
            finished_at=db_workout.finished_at.isoformat() if db_workout.finished_at else None,
            duration_seconds=db_workout.duration_seconds,
            notes=db_workout.notes
        )


@app.delete("/workouts/{workout_id}", response_model=dict)
async def delete_workout(workout_id: int):
    """
    Delete a workout and all its exercises/sets.
    
    Args:
        workout_id: The ID of the workout to delete
        
    Returns:
        dict: Success message
    """
    with get_session() as session:
        workout = session.query(Workout).filter(Workout.id == workout_id).first()
        if not workout:
            raise HTTPException(status_code=404, detail="Workout not found")
        
        # Delete related sets first
        session.query(ExerciseSet).filter(
            ExerciseSet.exercise_id.in_(
                session.query(Exercise.id).filter(Exercise.workout_id == workout_id)
            )
        ).delete(synchronize_session=False)
        
        # Delete related exercises
        session.query(Exercise).filter(
            Exercise.workout_id == workout_id
        ).delete(synchronize_session=False)
        
        # Delete the workout
        session.delete(workout)
        session.commit()
        
        return {"message": "Workout deleted successfully"}


# Mount static files for frontend
app.mount(
    path="/",
    app=StaticFiles(directory=FRONTEND_DIR, html=True),
    name="frontend"
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)