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

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import FRONTEND_DIR, PHOTOS_DIR, HAND_MEASUREMENTS
from .database import create_db_and_tables, get_session
from .models import Workout, Exercise, ExerciseSet
from .vision import analyze_food_photo as vision_analyze


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
    name: Optional[str] = None
    notes: Optional[str] = None


class WorkoutUpdate(BaseModel):
    """Request model for updating a workout."""
    name: Optional[str] = None
    finished_at: Optional[datetime] = None
    notes: Optional[str] = None
    exercises: Optional[List['ExerciseCreate']] = None


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


class WorkoutDetailResponse(BaseModel):
    """Response model for a workout with all exercises and sets."""
    id: int
    started_at: str
    finished_at: Optional[str]
    duration_seconds: Optional[int]
    name: Optional[str]
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
            name=workout.name,
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
            name=db_workout.name,
            notes=db_workout.notes
        )


@app.get("/workouts", response_model=List[WorkoutResponse])
async def get_workouts():
    """
    Get all workouts, most recent first.
    
    Returns:
        List[WorkoutResponse]: List of all workouts sorted by start time (newest first),
                               including exercises and their sets
    """
    with get_session() as session:
        workouts = session.query(Workout).order_by(Workout.started_at.desc()).all()
        
        result = []
        for workout in workouts:
            # Fetch exercises for this workout
            exercises = session.query(Exercise).filter(
                Exercise.workout_id == workout.id
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
                            hold_seconds=s.hold_seconds,
                            to_failure=s.to_failure,
                            rest_seconds=s.rest_seconds,
                            note=s.note
                        )
                        for s in sets
                    ]
                ))
            
            result.append(WorkoutResponse(
                id=workout.id,
                started_at=workout.started_at.isoformat(),
                finished_at=workout.finished_at.isoformat() if workout.finished_at else None,
                duration_seconds=workout.duration_seconds,
                name=workout.name,
                notes=workout.notes,
                exercises=exercises_list
            ))
        
        return result


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
                        hold_seconds=s.hold_seconds,
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
            name=workout.name,
            notes=workout.notes,
            exercises=exercises_list
        )


@app.patch("/workouts/{workout_id}", response_model=WorkoutDetailResponse)
async def update_workout(workout_id: int, workout_update: WorkoutUpdate):
    """
    Update a workout.
    
    Can finish the workout (set finished_at and compute duration_seconds),
    update notes, or add/edit exercises and sets via nested data.
    
    Args:
        workout_id: The ID of the workout to update
        workout_update: WorkoutUpdate model with new data
        
    Returns:
        WorkoutDetailResponse: The updated workout record with all exercises and sets
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
        
        if workout_update.name is not None:
            db_workout.name = workout_update.name
        if workout_update.notes is not None:
            db_workout.notes = workout_update.notes
        
        session.commit()
        
        # Handle adding/updating exercises if provided
        if workout_update.exercises is not None:
            for exercise_data in workout_update.exercises:
                db_exercise = None
                if exercise_data.id is not None:
                    db_exercise = session.query(Exercise).filter(
                        Exercise.id == exercise_data.id,
                        Exercise.workout_id == workout_id
                    ).first()

                if db_exercise is None:
                    # Fall back to matching by order, for callers that don't send an id
                    db_exercise = session.query(Exercise).filter(
                        Exercise.workout_id == workout_id,
                        Exercise.order == exercise_data.order
                    ).first()

                if db_exercise is None:
                    # Create new exercise
                    db_exercise = Exercise(
                        workout_id=workout_id,
                        name=exercise_data.name,
                        order=exercise_data.order
                    )
                    session.add(db_exercise)
                else:
                    # Update existing exercise's fields
                    db_exercise.name = exercise_data.name
                    db_exercise.order = exercise_data.order
                session.commit()
                session.refresh(db_exercise)

                # Sync sets for this exercise if provided
                if exercise_data.sets is not None:
                    kept_set_ids = set()
                    for set_data in exercise_data.sets:
                        db_set = None
                        if set_data.id is not None:
                            db_set = session.query(ExerciseSet).filter(
                                ExerciseSet.id == set_data.id,
                                ExerciseSet.exercise_id == db_exercise.id
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

                    # Remove sets that are no longer present (e.g. deleted client-side)
                    session.query(ExerciseSet).filter(
                        ExerciseSet.exercise_id == db_exercise.id,
                        ExerciseSet.id.not_in(kept_set_ids)
                    ).delete(synchronize_session=False)
                    session.commit()
        
        # Get all exercises with their sets for the response
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
                        hold_seconds=s.hold_seconds,
                        to_failure=s.to_failure,
                        rest_seconds=s.rest_seconds,
                        note=s.note
                    )
                    for s in sets
                ]
            ))
        
        # Refresh workout with final state
        session.refresh(db_workout)
        
        return WorkoutDetailResponse(
            id=db_workout.id,
            started_at=db_workout.started_at.isoformat(),
            finished_at=db_workout.finished_at.isoformat() if db_workout.finished_at else None,
            duration_seconds=db_workout.duration_seconds,
            name=db_workout.name,
            notes=db_workout.notes,
            exercises=exercises_list
        )


# ========== Photo Analysis Models ==========
class FoodItem(BaseModel):
    """A food item identified in a photo."""
    name: str
    estimated_portion_g: int


class FoodPhotoResponse(BaseModel):
    """Response model for food photo analysis."""
    items: List[FoodItem]
    photo_path: Optional[str] = None


@app.post("/meals/photo", response_model=FoodPhotoResponse)
async def analyze_food_photo(photo: UploadFile = File(...)):
    """
    Analyze a food photo using the vision model.
    
    This endpoint accepts an image upload, saves it to disk,
    sends it to LM Studio for visual analysis, and returns the recognized
    food items with their estimated portion sizes.
    
    Args:
        photo: The uploaded image file
        
    Returns:
        FoodPhotoResponse: List of food items with estimated portions in grams
    """
    import os
    import uuid
    
    # Ensure photos directory exists
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    
    # Generate a unique filename for the photo
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"meal_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
    photo_path = os.path.join(PHOTOS_DIR, filename)
    
    # Save the uploaded file
    with open(photo_path, "wb") as f:
        content = await photo.read()
        f.write(content)
    
    # Analyze the food photo using LM Studio
    items = await vision_analyze(photo_path, HAND_MEASUREMENTS)
    
    # Return the analysis results
    if items is None:
        items = []
        
    return FoodPhotoResponse(items=items, photo_path=photo_path)
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