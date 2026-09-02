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
- GET /exercises/names: List distinct exercise names already used across all logged workouts
- GET /exercises/logged: List logged exercises merged by base name, sorted by times done
- GET /exercises/previous: Get the sets from the last time an exercise was logged
- GET /exercises/progress: Get top set weight per workout for an exercise, for the Progress tab
- GET /exercises/custom: List user-added custom exercise names
- POST /exercises/custom: Persist a new custom exercise name for reuse in the picker
- GET /suggest-workout: Propose an all-upper-body or all-lower-body workout (~4-6 exercises) based on neglected muscles, glute priority, and the knee-strengthening list
- GET /knee-exercises: List the user's knee-strengthening exercise list
- POST /knee-exercises: Add an entry to the knee-strengthening list
- DELETE /knee-exercises/{id}: Remove an entry from the knee-strengthening list
- GET /foods/search: Search local food references (USDA + user-added) by description
- POST /foods/label-scan: Extract product name/macros from a nutrition label photo
- POST /foods/custom: Save a user-reviewed custom product
- PATCH /foods/custom/{id}: Update a custom product
- DELETE /foods/custom/{id}: Delete a custom product
- PATCH /foods/usda/{id}: Save a correction to a USDA food's name/macros
- DELETE /foods/usda/{id}/override: Revert a USDA food to its original values
- POST /foods/servings: Define a custom serving size for a food
- GET /foods/servings: List a food's servings
- PATCH /foods/servings/{id}: Update a serving
- DELETE /foods/servings/{id}: Delete a serving
- POST /meals: Save a meal with its food items (e.g. from manual food search)
- GET /meals: List all meals with their food items and totals
- GET /meals/{id}: Get one meal with all food items and totals
- PATCH /meals/{id}: Update a meal (name, date, add/edit/remove food items)
- DELETE /meals/{id}: Delete a meal
- POST /meal-templates: Save a reusable named combination of food items
- GET /meal-templates: List all saved meal templates
- PATCH /meal-templates/{id}: Update a meal template's name and items
- DELETE /meal-templates/{id}: Delete a meal template
- POST /checkins: Save a weekly check-in (photo + weight + measurements)
- GET /checkins: List all check-ins (most recent first)
- GET /checkins/{id}: Get one check-in
- PATCH /checkins/{id}: Update a check-in
- DELETE /checkins/{id}: Delete a check-in
- GET /goal: Get the active goal
- PUT /goal: Set/update the active goal
- Static file mount for frontend, and for saved photos at /photos
"""

import os
import re
import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import case, func, or_

from .config import FRONTEND_DIR, PHOTOS_DIR, HAND_MEASUREMENTS
from .database import create_db_and_tables, get_session
from .models import Workout, Exercise, CustomExercise, ExerciseSet, Food, UserFood, FoodServing, FoodOverride, Meal, FoodItem as FoodItemModel, MealTemplate, MealTemplateItem, WeeklyCheckin, Goal, KneeExercise, DailySkippedDay
from .vision import analyze_food_photo as vision_analyze
from .vision import analyze_nutrition_label as vision_analyze_label
from .muscle_groups import guess_muscle_group
from .workout_suggestion import seed_default_knee_exercises, suggest_workout


# Create FastAPI app
app = FastAPI(
    title="Fitness Tracker API",
    description="Backend API for the local fitness and nutrition tracking app",
    version="0.1.0"
)


@app.on_event("startup")
def on_startup():
    """
    Initialize database tables and seed default data on application startup.
    """
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


# Temporary diagnostic logging for 422s on upload endpoints - a real device
# has been hitting "Field required" on /foods/label-scan with no obvious
# client-side cause; this logs exactly what the server actually received so
# the next occurrence is diagnosable instead of a guess. Safe to remove once
# that's root-caused - it only logs, it doesn't change any response.
@app.exception_handler(RequestValidationError)
def log_validation_errors(request: Request, exc: RequestValidationError):
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
def health_check():
    """
    Health check endpoint.
    
    Returns:
        dict: Status indicating the API is running
    """
    return {"status": "ok", "service": "fitness-tracker-api"}


@app.post("/workouts", response_model=WorkoutResponse)
def start_workout(workout: WorkoutCreate):
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
def get_workouts():
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
                    muscle_group=exercise.muscle_group,
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
def get_workout(workout_id: int):
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
                muscle_group=exercise.muscle_group,
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
def update_workout(workout_id: int, workout_update: WorkoutUpdate):
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
                        order=exercise_data.order,
                        muscle_group=guess_muscle_group(exercise_data.name)
                    )
                    session.add(db_exercise)
                else:
                    # Update existing exercise's fields
                    db_exercise.name = exercise_data.name
                    db_exercise.order = exercise_data.order
                    db_exercise.muscle_group = guess_muscle_group(exercise_data.name)
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
                muscle_group=exercise.muscle_group,
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


# ========== Food Search Models ==========
class FoodServingResponse(BaseModel):
    """A custom serving size defined for a food, e.g. '1 rice cake = 9g'."""
    id: int
    label: str
    grams_per_unit: float


class FoodSearchResult(BaseModel):
    """A food reference match (USDA or user-added), with per-100g macros."""
    id: int
    description: str
    calories_kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    source: str  # "usda" or "custom"
    servings: List[FoodServingResponse] = []


def _servings_for_foods(session, usda_ids: List[int], custom_ids: List[int]) -> dict:
    """Batch-fetch servings for a set of foods, keyed by (food_id, food_source)."""
    by_key: dict = {}
    if usda_ids:
        for s in session.query(FoodServing).filter(
            FoodServing.food_source == "usda", FoodServing.food_id.in_(usda_ids)
        ).all():
            by_key.setdefault((s.food_id, s.food_source), []).append(
                FoodServingResponse(id=s.id, label=s.label, grams_per_unit=s.grams_per_unit)
            )
    if custom_ids:
        for s in session.query(FoodServing).filter(
            FoodServing.food_source == "custom", FoodServing.food_id.in_(custom_ids)
        ).all():
            by_key.setdefault((s.food_id, s.food_source), []).append(
                FoodServingResponse(id=s.id, label=s.label, grams_per_unit=s.grams_per_unit)
            )
    return by_key


def _rank_match(description: str, query: str) -> int:
    """Rank a description's match quality against a search query: 0 = exact,
    1 = prefix, 2 = other substring match. Lower ranks sort first."""
    lower_desc = description.lower()
    lower_query = query.lower()
    if lower_desc == lower_query:
        return 0
    if lower_desc.startswith(lower_query):
        return 1
    return 2


# ========== Food Search Endpoint ==========
@app.get("/foods/search", response_model=List[FoodSearchResult])
def search_foods(q: str):
    """
    Search the local food references (USDA import + user-added products) by
    description.

    Case-insensitive substring match, ordered so exact matches rank first,
    then prefix matches, then other substring matches (shorter descriptions
    first as a tiebreak), limited to 20 results across both sources.

    Args:
        q: Search query (e.g. "chicken")

    Returns:
        List[FoodSearchResult]: Matching foods with their per-100g macros,
        each tagged with source "usda" or "custom"
    """
    query = q.strip()
    if not query:
        return []

    like_pattern = f"%{query}%"
    with get_session() as session:
        match_rank = case(
            (func.lower(Food.description) == query.lower(), 0),
            (Food.description.ilike(f"{query}%"), 1),
            else_=2,
        )
        usda_foods = (
            session.query(Food)
            .filter(Food.description.ilike(like_pattern))
            .order_by(match_rank, func.length(Food.description))
            .limit(20)
            .all()
        )

        user_match_rank = case(
            (func.lower(UserFood.description) == query.lower(), 0),
            (UserFood.description.ilike(f"{query}%"), 1),
            else_=2,
        )
        user_foods = (
            session.query(UserFood)
            .filter(UserFood.description.ilike(like_pattern))
            .order_by(user_match_rank, func.length(UserFood.description))
            .limit(20)
            .all()
        )

        servings_by_key = _servings_for_foods(
            session, [f.id for f in usda_foods], [f.id for f in user_foods]
        )

        usda_ids = [f.id for f in usda_foods]
        overrides_by_food_id = {}
        if usda_ids:
            for o in session.query(FoodOverride).filter(FoodOverride.food_id.in_(usda_ids)).all():
                overrides_by_food_id[o.food_id] = o

        results = [
            FoodSearchResult(
                id=food.id,
                description=(overrides_by_food_id[food.id].description if food.id in overrides_by_food_id else food.description),
                calories_kcal=(overrides_by_food_id[food.id].calories_kcal if food.id in overrides_by_food_id else food.calories_kcal),
                protein_g=(overrides_by_food_id[food.id].protein_g if food.id in overrides_by_food_id else food.protein_g),
                carbs_g=(overrides_by_food_id[food.id].carbs_g if food.id in overrides_by_food_id else food.carbs_g),
                fat_g=(overrides_by_food_id[food.id].fat_g if food.id in overrides_by_food_id else food.fat_g),
                source="usda",
                servings=servings_by_key.get((food.id, "usda"), []),
            )
            for food in usda_foods
        ] + [
            FoodSearchResult(
                id=food.id,
                description=food.description,
                calories_kcal=food.calories_kcal,
                protein_g=food.protein_g,
                carbs_g=food.carbs_g,
                fat_g=food.fat_g,
                source="custom",
                servings=servings_by_key.get((food.id, "custom"), []),
            )
            for food in user_foods
        ]

        results.sort(key=lambda r: (_rank_match(r.description, query), len(r.description)))
        return results[:20]


# ========== Nutrition Label Scan / Custom Food Models ==========
class LabelScanResponse(BaseModel):
    """Values extracted from a nutrition label photo. Any field the model
    couldn't read is None - never a guessed number."""
    product_name: Optional[str] = None
    serving_size_g: Optional[float] = None
    calories_kcal: Optional[float] = None
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None


class CustomFoodCreate(BaseModel):
    """Request model for saving a user-reviewed custom product."""
    description: str
    calories_kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


# ========== Nutrition Label Scan / Custom Food Endpoints ==========
@app.post("/foods/label-scan", response_model=LabelScanResponse)
async def scan_nutrition_label(photo: UploadFile = File(...)):
    """
    Analyze a nutrition label photo and extract the printed product name,
    serving size, and per-serving macros for the user to review before saving.

    The model only transcribes what's printed - never estimates. If LM
    Studio is unavailable or nothing could be read, returns all-null fields
    (200 OK) rather than an error, so the caller can fall back to a blank
    manual-entry form.

    Args:
        photo: The uploaded label photo

    Returns:
        LabelScanResponse: Extracted fields (null where unreadable/unavailable)
    """
    image_bytes = await photo.read()
    extracted = await vision_analyze_label(image_bytes)

    if extracted is None:
        return LabelScanResponse()

    return LabelScanResponse(**extracted)


@app.post("/foods/custom", response_model=FoodSearchResult)
def create_custom_food(food: CustomFoodCreate):
    """
    Save a user-reviewed custom product (e.g. from a nutrition label scan)
    to the local food reference, so it can be found via /foods/search and
    used the same way as a USDA food.

    Stored in a separate table from the USDA import (UserFood), so it is
    never lost when the USDA dataset is re-imported.

    Args:
        food: CustomFoodCreate with the product's name and per-100g macros

    Returns:
        FoodSearchResult: The saved product, source="custom"
    """
    description = food.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Product name is required")

    with get_session() as session:
        db_food = UserFood(
            description=description,
            calories_kcal=food.calories_kcal,
            protein_g=food.protein_g,
            carbs_g=food.carbs_g,
            fat_g=food.fat_g,
        )
        session.add(db_food)
        session.commit()
        session.refresh(db_food)

        return FoodSearchResult(
            id=db_food.id,
            description=db_food.description,
            calories_kcal=db_food.calories_kcal,
            protein_g=db_food.protein_g,
            carbs_g=db_food.carbs_g,
            fat_g=db_food.fat_g,
            source="custom",
        )


@app.patch("/foods/custom/{food_id}", response_model=FoodSearchResult)
def update_custom_food(food_id: int, food: CustomFoodCreate):
    """
    Update a previously-added custom product (name and/or per-100g macros).

    Args:
        food_id: The id of the UserFood row to update
        food: CustomFoodCreate with the corrected name and per-100g macros

    Returns:
        FoodSearchResult: The updated product, source="custom"
    """
    description = food.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Product name is required")

    with get_session() as session:
        db_food = session.query(UserFood).filter(UserFood.id == food_id).first()
        if not db_food:
            raise HTTPException(status_code=404, detail="Product not found")

        db_food.description = description
        db_food.calories_kcal = food.calories_kcal
        db_food.protein_g = food.protein_g
        db_food.carbs_g = food.carbs_g
        db_food.fat_g = food.fat_g
        session.commit()
        session.refresh(db_food)

        return FoodSearchResult(
            id=db_food.id,
            description=db_food.description,
            calories_kcal=db_food.calories_kcal,
            protein_g=db_food.protein_g,
            carbs_g=db_food.carbs_g,
            fat_g=db_food.fat_g,
            source="custom",
        )


@app.delete("/foods/custom/{food_id}")
def delete_custom_food(food_id: int):
    """
    Delete a custom product (and any servings defined for it).

    Args:
        food_id: The id of the UserFood row to delete

    Returns:
        dict: Success message
    """
    with get_session() as session:
        db_food = session.query(UserFood).filter(UserFood.id == food_id).first()
        if not db_food:
            raise HTTPException(status_code=404, detail="Product not found")

        session.query(FoodServing).filter(
            FoodServing.food_id == food_id, FoodServing.food_source == "custom"
        ).delete(synchronize_session=False)

        session.delete(db_food)
        session.commit()

        return {"message": "Product deleted successfully"}


@app.patch("/foods/usda/{food_id}", response_model=FoodSearchResult)
def update_usda_food(food_id: int, food: CustomFoodCreate):
    """
    Save a correction to a USDA food's name/macros.

    Stored as a separate override row rather than editing the Food table
    directly, since import_usda.py clears and reloads that whole table on
    every run - a direct edit would vanish on the next USDA refresh. Search
    results apply the override on top of the base USDA row automatically.

    Args:
        food_id: The id of the Food row to correct
        food: CustomFoodCreate with the corrected name and per-100g macros

    Returns:
        FoodSearchResult: The food with the override applied, source="usda"
    """
    description = food.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Food name is required")

    with get_session() as session:
        base_food = session.query(Food).filter(Food.id == food_id).first()
        if not base_food:
            raise HTTPException(status_code=404, detail="Food not found")

        override = session.query(FoodOverride).filter(FoodOverride.food_id == food_id).first()
        if override is None:
            override = FoodOverride(food_id=food_id, food_source="usda", description=description,
                                     calories_kcal=food.calories_kcal, protein_g=food.protein_g,
                                     carbs_g=food.carbs_g, fat_g=food.fat_g)
            session.add(override)
        else:
            override.description = description
            override.calories_kcal = food.calories_kcal
            override.protein_g = food.protein_g
            override.carbs_g = food.carbs_g
            override.fat_g = food.fat_g

        session.commit()
        session.refresh(override)

        return FoodSearchResult(
            id=food_id,
            description=override.description,
            calories_kcal=override.calories_kcal,
            protein_g=override.protein_g,
            carbs_g=override.carbs_g,
            fat_g=override.fat_g,
            source="usda",
        )


@app.delete("/foods/usda/{food_id}/override")
def reset_usda_food(food_id: int):
    """
    Discard a correction and revert a USDA food back to its original
    imported name/macros.

    Args:
        food_id: The id of the Food row to reset

    Returns:
        dict: Success message
    """
    with get_session() as session:
        override = session.query(FoodOverride).filter(FoodOverride.food_id == food_id).first()
        if not override:
            raise HTTPException(status_code=404, detail="No correction exists for this food")

        session.delete(override)
        session.commit()

        return {"message": "Reverted to the original USDA values"}


# ========== Food Serving Models ==========
class FoodServingCreate(BaseModel):
    """Request model for defining a custom serving size for a food."""
    food_id: int
    food_source: str  # "usda" or "custom"
    label: str
    grams_per_unit: float


class FoodServingUpdate(BaseModel):
    """Request model for updating a serving's label/grams_per_unit."""
    label: str
    grams_per_unit: float


# ========== Food Serving Endpoints ==========
@app.post("/foods/servings", response_model=FoodServingResponse)
def create_food_serving(serving: FoodServingCreate):
    """
    Define a custom serving size for a food (e.g. "1 rice cake = 9g"), so
    amounts can be logged as a count of servings instead of grams.

    Args:
        serving: FoodServingCreate with the food reference, label, and grams per unit

    Returns:
        FoodServingResponse: The saved serving
    """
    label = serving.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Serving label is required")
    if serving.food_source not in ("usda", "custom"):
        raise HTTPException(status_code=400, detail="food_source must be 'usda' or 'custom'")
    if serving.grams_per_unit <= 0:
        raise HTTPException(status_code=400, detail="grams_per_unit must be greater than 0")

    with get_session() as session:
        db_serving = FoodServing(
            food_id=serving.food_id,
            food_source=serving.food_source,
            label=label,
            grams_per_unit=serving.grams_per_unit,
        )
        session.add(db_serving)
        session.commit()
        session.refresh(db_serving)

        return FoodServingResponse(id=db_serving.id, label=db_serving.label, grams_per_unit=db_serving.grams_per_unit)


@app.get("/foods/servings", response_model=List[FoodServingResponse])
def list_food_servings(food_id: int, food_source: str):
    """
    List the servings defined for a food.

    Args:
        food_id: id of the food in its source table
        food_source: "usda" or "custom"

    Returns:
        List[FoodServingResponse]: The food's servings
    """
    with get_session() as session:
        servings = session.query(FoodServing).filter(
            FoodServing.food_id == food_id, FoodServing.food_source == food_source
        ).all()
        return [FoodServingResponse(id=s.id, label=s.label, grams_per_unit=s.grams_per_unit) for s in servings]


@app.patch("/foods/servings/{serving_id}", response_model=FoodServingResponse)
def update_food_serving(serving_id: int, serving: FoodServingUpdate):
    """
    Update a serving's label and/or grams per unit.

    Args:
        serving_id: The ID of the serving to update
        serving: FoodServingUpdate with the corrected label and grams per unit

    Returns:
        FoodServingResponse: The updated serving
    """
    label = serving.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Serving label is required")
    if serving.grams_per_unit <= 0:
        raise HTTPException(status_code=400, detail="grams_per_unit must be greater than 0")

    with get_session() as session:
        db_serving = session.query(FoodServing).filter(FoodServing.id == serving_id).first()
        if not db_serving:
            raise HTTPException(status_code=404, detail="Serving not found")

        db_serving.label = label
        db_serving.grams_per_unit = serving.grams_per_unit
        session.commit()
        session.refresh(db_serving)

        return FoodServingResponse(id=db_serving.id, label=db_serving.label, grams_per_unit=db_serving.grams_per_unit)


@app.delete("/foods/servings/{serving_id}")
def delete_food_serving(serving_id: int):
    """
    Delete a custom serving size.

    Args:
        serving_id: The ID of the serving to delete

    Returns:
        dict: Success message
    """
    with get_session() as session:
        serving = session.query(FoodServing).filter(FoodServing.id == serving_id).first()
        if not serving:
            raise HTTPException(status_code=404, detail="Serving not found")

        session.delete(serving)
        session.commit()

        return {"message": "Serving deleted successfully"}


# ========== Meal Models ==========
class MealFoodItemCreate(BaseModel):
    """A single food item to add to a meal, with macros already scaled to the eaten portion."""
    id: Optional[int] = None  # existing FoodItem id, for updates; omitted/None means "create new"
    fdc_id: Optional[int] = None
    name: str
    grams: float
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_label: Optional[str] = None  # e.g. "rice cake", if logged via a serving instead of raw grams
    serving_count: Optional[float] = None  # e.g. 3, pairs with serving_label


class MealCreate(BaseModel):
    """Request model for saving a meal with its food items."""
    name: Optional[str] = None
    meal_date: Optional[str] = None  # ISO date string (YYYY-MM-DD); defaults to today. Ignored if meal_time is given.
    meal_time: Optional[str] = None  # ISO datetime string (e.g. "2026-08-15T19:30"); defaults to now. Its date also becomes meal_date, so the two never disagree.
    items: List[MealFoodItemCreate]


def _parse_meal_time(value: str) -> datetime:
    """Parse a meal_time ISO datetime string (e.g. from an HTML datetime-local
    input), raising a 400 on malformed input rather than a raw ValueError."""
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="meal_time must be an ISO datetime, e.g. 2026-08-15T19:30")


class MealFoodItemResponse(BaseModel):
    """Response model for a saved food item."""
    id: int
    fdc_id: Optional[int]
    name: str
    grams: float
    calories: Optional[float]
    protein_g: Optional[float]
    carbs_g: Optional[float]
    fat_g: Optional[float]
    source: Optional[str]
    serving_label: Optional[str] = None
    serving_count: Optional[float] = None


class MealResponse(BaseModel):
    """Response model for a saved meal, with its items and totals."""
    id: int
    name: str
    meal_date: str
    meal_time: Optional[str] = None
    items: List[MealFoodItemResponse]
    total_calories: float
    total_protein_g: float
    total_carbs_g: float
    total_fat_g: float


# ========== Meal Endpoints ==========
@app.post("/meals", response_model=MealResponse)
def create_meal(meal: MealCreate):
    """
    Save a meal with its food items (e.g. from manual food search).

    Each item is stored as a FoodItem with source="search", its grams in
    `quantity` (unit="g"), and the macros the caller already computed
    (per-100g macros x grams / 100).

    Args:
        meal: MealCreate with an optional name and a list of food items

    Returns:
        MealResponse: The saved meal with its items and totals
    """
    if not meal.items:
        raise HTTPException(status_code=400, detail="Meal must have at least one food item")

    with get_session() as session:
        meal_kwargs = {"name": meal.name or "Meal"}
        if meal.meal_time:
            parsed_time = _parse_meal_time(meal.meal_time)
            meal_kwargs["meal_time"] = parsed_time
            meal_kwargs["meal_date"] = parsed_time.date()
        elif meal.meal_date:
            try:
                meal_kwargs["meal_date"] = date.fromisoformat(meal.meal_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="meal_date must be YYYY-MM-DD")
        db_meal = Meal(**meal_kwargs)
        session.add(db_meal)
        session.commit()
        session.refresh(db_meal)

        items_response = []
        total_calories = total_protein_g = total_carbs_g = total_fat_g = 0.0
        for item in meal.items:
            db_item = FoodItemModel(
                meal_id=db_meal.id,
                name=item.name,
                quantity=item.grams,
                unit="g",
                calories=item.calories,
                protein_g=item.protein_g,
                carbs_g=item.carbs_g,
                fat_g=item.fat_g,
                source="search",
                fdc_id=item.fdc_id,
                serving_label=item.serving_label,
                serving_count=item.serving_count,
            )
            session.add(db_item)
            session.commit()
            session.refresh(db_item)

            items_response.append(MealFoodItemResponse(
                id=db_item.id,
                fdc_id=db_item.fdc_id,
                name=db_item.name,
                grams=db_item.quantity,
                calories=db_item.calories,
                protein_g=db_item.protein_g,
                carbs_g=db_item.carbs_g,
                fat_g=db_item.fat_g,
                source=db_item.source,
                serving_label=db_item.serving_label,
                serving_count=db_item.serving_count,
            ))
            total_calories += item.calories
            total_protein_g += item.protein_g
            total_carbs_g += item.carbs_g
            total_fat_g += item.fat_g

        return MealResponse(
            id=db_meal.id,
            name=db_meal.name,
            meal_date=db_meal.meal_date.isoformat(),
            meal_time=db_meal.meal_time.isoformat() if db_meal.meal_time else None,
            items=items_response,
            total_calories=total_calories,
            total_protein_g=total_protein_g,
            total_carbs_g=total_carbs_g,
            total_fat_g=total_fat_g,
        )


@app.get("/meals", response_model=List[MealResponse])
def get_meals():
    """
    Get all meals, most recent first (by meal_date, the day the meal is
    actually for - not created_at, which is just when the row was inserted
    and can disagree with meal_date after an edit, a backdated entry, or
    "Copy to Today"). Same-day meals are ordered by created_at as a tiebreak.

    Returns:
        List[MealResponse]: All meals with items and computed totals
    """
    with get_session() as session:
        meals = session.query(Meal).order_by(Meal.meal_date.desc(), Meal.created_at.desc()).all()

        result = []
        for db_meal in meals:
            items = session.query(FoodItemModel).filter(
                FoodItemModel.meal_id == db_meal.id
            ).all()

            items_response = [
                MealFoodItemResponse(
                    id=item.id,
                    fdc_id=item.fdc_id,
                    name=item.name,
                    grams=item.quantity,
                    calories=item.calories,
                    protein_g=item.protein_g,
                    carbs_g=item.carbs_g,
                    fat_g=item.fat_g,
                    source=item.source,
                    serving_label=item.serving_label,
                    serving_count=item.serving_count,
                )
                for item in items
            ]

            result.append(MealResponse(
                id=db_meal.id,
                name=db_meal.name,
                meal_date=db_meal.meal_date.isoformat(),
                meal_time=db_meal.meal_time.isoformat() if db_meal.meal_time else None,
                items=items_response,
                total_calories=sum(i.calories or 0 for i in items),
                total_protein_g=sum(i.protein_g or 0 for i in items),
                total_carbs_g=sum(i.carbs_g or 0 for i in items),
                total_fat_g=sum(i.fat_g or 0 for i in items),
            ))

        return result


# ========== Nutrition Diary Endpoints ==========
@app.get("/nutrition/by-day")
def get_nutrition_by_day():
    """
    Get meals grouped by calendar date, most recent date first.
    Each day includes its total macros (sum of all meals) and the list of meals
    with their items and per-meal totals.

    Returns:
        List[Dict]: Days with date, daily_totals, and meals list
    """
    with get_session() as session:
        # Get all meals ordered by date (most recent first), then by created_at
        meals = session.query(Meal).order_by(
            Meal.meal_date.desc(), 
            Meal.created_at.desc()
        ).all()

        # Group meals by date
        days_dict = {}
        for db_meal in meals:
            meal_date_str = db_meal.meal_date.isoformat()
            
            if meal_date_str not in days_dict:
                days_dict[meal_date_str] = {
                    "date": meal_date_str,
                    "meals": [],
                    "daily_totals": {
                        "calories": 0,
                        "protein_g": 0,
                        "carbs_g": 0,
                        "fat_g": 0
                    }
                }

            # Get items for this meal
            items = session.query(FoodItemModel).filter(
                FoodItemModel.meal_id == db_meal.id
            ).all()

            # Calculate per-meal totals
            meal_calories = sum(i.calories or 0 for i in items)
            meal_protein_g = sum(i.protein_g or 0 for i in items)
            meal_carbs_g = sum(i.carbs_g or 0 for i in items)
            meal_fat_g = sum(i.fat_g or 0 for i in items)

            # Build meal response
            meal_response = {
                "id": db_meal.id,
                "name": db_meal.name or "Meal",
                "meal_date": db_meal.meal_date.isoformat(),
                "meal_time": db_meal.meal_time.isoformat() if db_meal.meal_time else None,
                "items": [
                    {
                        "id": item.id,
                        "fdc_id": item.fdc_id,
                        "name": item.name,
                        "grams": item.quantity,
                        "calories": item.calories,
                        "protein_g": item.protein_g,
                        "carbs_g": item.carbs_g,
                        "fat_g": item.fat_g,
                        "source": item.source,
                        "serving_label": item.serving_label,
                        "serving_count": item.serving_count,
                    }
                    for item in items
                ],
                "total_calories": meal_calories,
                "total_protein_g": meal_protein_g,
                "total_carbs_g": meal_carbs_g,
                "total_fat_g": meal_fat_g
            }

            days_dict[meal_date_str]["meals"].append(meal_response)

            # Update daily totals
            days_dict[meal_date_str]["daily_totals"]["calories"] += meal_calories
            days_dict[meal_date_str]["daily_totals"]["protein_g"] += meal_protein_g
            days_dict[meal_date_str]["daily_totals"]["carbs_g"] += meal_carbs_g
            days_dict[meal_date_str]["daily_totals"]["fat_g"] += meal_fat_g

        # Convert to list and return (days are already sorted by date DESC)
        return list(days_dict.values())


# ========== Meal Detail Endpoints ==========
@app.get("/meals/{meal_id}", response_model=MealResponse)
def get_meal(meal_id: int):
    """
    Get one meal with all food items and totals.

    Args:
        meal_id: The ID of the meal to retrieve

    Returns:
        MealResponse: The meal with its items and computed totals
    """
    with get_session() as session:
        db_meal = session.query(Meal).filter(Meal.id == meal_id).first()
        if not db_meal:
            raise HTTPException(status_code=404, detail="Meal not found")

        items = session.query(FoodItemModel).filter(
            FoodItemModel.meal_id == meal_id
        ).all()

        items_response = [
            MealFoodItemResponse(
                id=item.id,
                fdc_id=item.fdc_id,
                name=item.name,
                grams=item.quantity,
                calories=item.calories,
                protein_g=item.protein_g,
                carbs_g=item.carbs_g,
                fat_g=item.fat_g,
                source=item.source,
                serving_label=item.serving_label,
                serving_count=item.serving_count,
            )
            for item in items
        ]

        return MealResponse(
            id=db_meal.id,
            name=db_meal.name,
            meal_date=db_meal.meal_date.isoformat(),
            meal_time=db_meal.meal_time.isoformat() if db_meal.meal_time else None,
            items=items_response,
            total_calories=sum(i.calories or 0 for i in items),
            total_protein_g=sum(i.protein_g or 0 for i in items),
            total_carbs_g=sum(i.carbs_g or 0 for i in items),
            total_fat_g=sum(i.fat_g or 0 for i in items),
        )


@app.patch("/meals/{meal_id}", response_model=MealResponse)
def update_meal(meal_id: int, meal_update: MealCreate):
    """
    Update a meal (including adding/removing/changing food items).

    Args:
        meal_id: The ID of the meal to update
        meal_update: MealCreate model with new data

    Returns:
        MealResponse: The updated meal record
    """
    with get_session() as session:
        db_meal = session.query(Meal).filter(Meal.id == meal_id).first()
        if not db_meal:
            raise HTTPException(status_code=404, detail="Meal not found")

        # Update meal name/date/time if provided
        if meal_update.name is not None:
            db_meal.name = meal_update.name
        if meal_update.meal_time:
            parsed_time = _parse_meal_time(meal_update.meal_time)
            db_meal.meal_time = parsed_time
            db_meal.meal_date = parsed_time.date()
        elif meal_update.meal_date:
            try:
                db_meal.meal_date = date.fromisoformat(meal_update.meal_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="meal_date must be YYYY-MM-DD")

        session.commit()

        # Handle updating food items
        if meal_update.items is not None:
            kept_item_ids = set()
            for item_data in meal_update.items:
                db_item = None
                if item_data.id is not None:
                    db_item = session.query(FoodItemModel).filter(
                        FoodItemModel.id == item_data.id,
                        FoodItemModel.meal_id == meal_id
                    ).first()

                if db_item is None:
                    # Create new item
                    db_item = FoodItemModel(
                        meal_id=meal_id,
                        name=item_data.name,
                        quantity=item_data.grams,
                        unit="g",
                        calories=item_data.calories,
                        protein_g=item_data.protein_g,
                        carbs_g=item_data.carbs_g,
                        fat_g=item_data.fat_g,
                        source="search",
                        fdc_id=item_data.fdc_id,
                        serving_label=item_data.serving_label,
                        serving_count=item_data.serving_count,
                    )
                    session.add(db_item)
                else:
                    # Update existing item
                    db_item.name = item_data.name
                    db_item.quantity = item_data.grams
                    db_item.calories = item_data.calories
                    db_item.protein_g = item_data.protein_g
                    db_item.carbs_g = item_data.carbs_g
                    db_item.fat_g = item_data.fat_g
                    db_item.fdc_id = item_data.fdc_id
                    db_item.serving_label = item_data.serving_label
                    db_item.serving_count = item_data.serving_count

                session.commit()
                session.refresh(db_item)
                kept_item_ids.add(db_item.id)

            # Remove items that are no longer present
            session.query(FoodItemModel).filter(
                FoodItemModel.meal_id == meal_id,
                FoodItemModel.id.not_in(kept_item_ids)
            ).delete(synchronize_session=False)
            session.commit()

        # Re-fetch items for response
        items = session.query(FoodItemModel).filter(
            FoodItemModel.meal_id == meal_id
        ).all()

        items_response = [
            MealFoodItemResponse(
                id=item.id,
                fdc_id=item.fdc_id,
                name=item.name,
                grams=item.quantity,
                calories=item.calories,
                protein_g=item.protein_g,
                carbs_g=item.carbs_g,
                fat_g=item.fat_g,
                source=item.source,
                serving_label=item.serving_label,
                serving_count=item.serving_count,
            )
            for item in items
        ]

        return MealResponse(
            id=db_meal.id,
            name=db_meal.name,
            meal_date=db_meal.meal_date.isoformat(),
            meal_time=db_meal.meal_time.isoformat() if db_meal.meal_time else None,
            items=items_response,
            total_calories=sum(i.calories or 0 for i in items),
            total_protein_g=sum(i.protein_g or 0 for i in items),
            total_carbs_g=sum(i.carbs_g or 0 for i in items),
            total_fat_g=sum(i.fat_g or 0 for i in items),
        )


@app.delete("/meals/{meal_id}")
def delete_meal(meal_id: int):
    """
    Delete a meal and all its food items.

    Args:
        meal_id: The ID of the meal to delete

    Returns:
        dict: Success message
    """
    with get_session() as session:
        meal = session.query(Meal).filter(Meal.id == meal_id).first()
        if not meal:
            raise HTTPException(status_code=404, detail="Meal not found")

        # Delete food items first
        session.query(FoodItemModel).filter(
            FoodItemModel.meal_id == meal_id
        ).delete(synchronize_session=False)

        # Delete the meal
        session.delete(meal)
        session.commit()

        return {"message": "Meal deleted successfully"}


# ========== Meal Template Endpoints ==========
class MealTemplateItemCreate(BaseModel):
    """A single food item to save into a meal template, with macros already scaled to the saved portion."""
    fdc_id: Optional[int] = None
    name: str
    grams: float
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_label: Optional[str] = None
    serving_count: Optional[float] = None


class MealTemplateCreate(BaseModel):
    """Request model for saving a reusable meal template."""
    name: str
    items: List[MealTemplateItemCreate]


class MealTemplateItemResponse(BaseModel):
    """Response model for a saved meal template item."""
    id: int
    fdc_id: Optional[int]
    name: str
    grams: float
    calories: Optional[float]
    protein_g: Optional[float]
    carbs_g: Optional[float]
    fat_g: Optional[float]
    serving_label: Optional[str] = None
    serving_count: Optional[float] = None


class MealTemplateResponse(BaseModel):
    """Response model for a saved meal template with its items and totals."""
    id: int
    name: str
    items: List[MealTemplateItemResponse]
    total_calories: float
    total_protein_g: float
    total_carbs_g: float
    total_fat_g: float


def _meal_template_response(template: MealTemplate, items: List[MealTemplateItem]) -> MealTemplateResponse:
    return MealTemplateResponse(
        id=template.id,
        name=template.name,
        items=[
            MealTemplateItemResponse(
                id=i.id, fdc_id=i.fdc_id, name=i.name, grams=i.grams,
                calories=i.calories, protein_g=i.protein_g, carbs_g=i.carbs_g, fat_g=i.fat_g,
                serving_label=i.serving_label, serving_count=i.serving_count,
            )
            for i in items
        ],
        total_calories=sum(i.calories or 0 for i in items),
        total_protein_g=sum(i.protein_g or 0 for i in items),
        total_carbs_g=sum(i.carbs_g or 0 for i in items),
        total_fat_g=sum(i.fat_g or 0 for i in items),
    )


@app.post("/meal-templates", response_model=MealTemplateResponse)
def create_meal_template(template: MealTemplateCreate):
    """
    Save a reusable combination of food items as a named template (e.g.
    "Usual Salad Bar Lunch"), so it can be logged again later without
    re-searching for each item. Independent of any specific logged day.

    Args:
        template: MealTemplateCreate with a name and a list of food items

    Returns:
        MealTemplateResponse: The saved template with its items and totals
    """
    if not template.items:
        raise HTTPException(status_code=400, detail="Template must have at least one food item")

    name = template.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name cannot be empty")

    with get_session() as session:
        db_template = MealTemplate(name=name)
        session.add(db_template)
        session.commit()
        session.refresh(db_template)

        db_items = []
        for item in template.items:
            db_item = MealTemplateItem(
                template_id=db_template.id,
                name=item.name,
                grams=item.grams,
                calories=item.calories,
                protein_g=item.protein_g,
                carbs_g=item.carbs_g,
                fat_g=item.fat_g,
                fdc_id=item.fdc_id,
                serving_label=item.serving_label,
                serving_count=item.serving_count,
            )
            session.add(db_item)
            session.commit()
            session.refresh(db_item)
            db_items.append(db_item)

        return _meal_template_response(db_template, db_items)


@app.patch("/meal-templates/{template_id}", response_model=MealTemplateResponse)
def update_meal_template(template_id: int, template: MealTemplateCreate):
    """
    Update a meal template's name and items. Replaces all items with the
    given list - simplest correct approach, since template items aren't
    referenced anywhere else in the system.

    Args:
        template_id: The ID of the meal template to update
        template: MealTemplateCreate with the new name and items

    Returns:
        MealTemplateResponse: The updated template with its items and totals
    """
    if not template.items:
        raise HTTPException(status_code=400, detail="Template must have at least one food item")

    name = template.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name cannot be empty")

    with get_session() as session:
        db_template = session.query(MealTemplate).filter(MealTemplate.id == template_id).first()
        if not db_template:
            raise HTTPException(status_code=404, detail="Meal template not found")

        db_template.name = name
        session.commit()
        session.refresh(db_template)

        session.query(MealTemplateItem).filter(
            MealTemplateItem.template_id == template_id
        ).delete(synchronize_session=False)
        session.commit()

        db_items = []
        for item in template.items:
            db_item = MealTemplateItem(
                template_id=db_template.id,
                name=item.name,
                grams=item.grams,
                calories=item.calories,
                protein_g=item.protein_g,
                carbs_g=item.carbs_g,
                fat_g=item.fat_g,
                fdc_id=item.fdc_id,
                serving_label=item.serving_label,
                serving_count=item.serving_count,
            )
            session.add(db_item)
            session.commit()
            session.refresh(db_item)
            db_items.append(db_item)

        return _meal_template_response(db_template, db_items)


@app.get("/meal-templates", response_model=List[MealTemplateResponse])
def list_meal_templates():
    """
    List all saved meal templates with their items and totals, alphabetically
    by name.

    Returns:
        List of MealTemplateResponse
    """
    with get_session() as session:
        templates = session.query(MealTemplate).order_by(MealTemplate.name).all()

        result = []
        for t in templates:
            items = session.query(MealTemplateItem).filter(
                MealTemplateItem.template_id == t.id
            ).order_by(MealTemplateItem.id).all()
            result.append(_meal_template_response(t, items))

        return result


@app.delete("/meal-templates/{template_id}")
def delete_meal_template(template_id: int):
    """
    Delete a meal template and its items.

    Args:
        template_id: The ID of the meal template to delete

    Returns:
        dict: Success message
    """
    with get_session() as session:
        template = session.query(MealTemplate).filter(MealTemplate.id == template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail="Meal template not found")

        session.query(MealTemplateItem).filter(
            MealTemplateItem.template_id == template_id
        ).delete(synchronize_session=False)
        session.delete(template)
        session.commit()

        return {"message": "Meal template deleted successfully"}


@app.delete("/workouts/{workout_id}")
def delete_workout(workout_id: int):
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


@app.delete("/workouts/{workout_id}/exercises/{exercise_id}")
def delete_exercise(workout_id: int, exercise_id: int):
    """
    Remove a single exercise (and its sets) from a workout, identified by its unique id.

    Args:
        workout_id: The ID of the workout the exercise belongs to
        exercise_id: The ID of the exercise to remove

    Returns:
        dict: Success message
    """
    with get_session() as session:
        exercise = session.query(Exercise).filter(
            Exercise.id == exercise_id,
            Exercise.workout_id == workout_id
        ).first()
        if not exercise:
            raise HTTPException(status_code=404, detail="Exercise not found")

        session.query(ExerciseSet).filter(
            ExerciseSet.exercise_id == exercise_id
        ).delete(synchronize_session=False)

        session.delete(exercise)
        session.commit()

        return {"message": "Exercise deleted successfully"}


class CustomExerciseCreate(BaseModel):
    """Request body for creating a custom exercise."""
    name: str


def _base_exercise_name(name: str) -> str:
    """
    Strip a trailing equipment qualifier like " (Barbell)" so e.g. "Romanian
    Deadlift" and "Romanian Deadlift (Barbell)" are treated as the same
    exercise when grouping logged history.
    """
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()


@app.get("/exercises/logged")
def list_logged_exercises():
    """
    List exercises that have actually been logged in a workout, merged by
    base name (stripping equipment qualifiers like "(Barbell)") so history
    logged under slightly different names counts as the same exercise.
    Sorted by how many times each has been logged, most-frequent first.
    Read-only - does not change how workouts are stored.

    Returns:
        List of {name, count, variants} - name is the merged base name,
        count is total times logged, variants lists the raw names merged into it
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


@app.get("/exercises/names")
def list_exercise_names():
    """
    List the distinct exercise names already used across all logged workouts
    (e.g. from imported history), sorted alphabetically. Read-only - does not
    change how workouts are stored.

    Returns:
        List of distinct exercise name strings
    """
    with get_session() as session:
        rows = session.query(Exercise.name).distinct().order_by(Exercise.name).all()
        return [r[0] for r in rows]


@app.get("/exercises/previous")
def get_previous_exercise_sets(name: str, exclude_workout_id: Optional[int] = None):
    """
    Get the sets logged for an exercise the last time it was done, so the picker
    can show "Previous" reference values. Read-only - does not change how
    workouts are stored.

    Args:
        name: Exercise name to look up (case-insensitive)
        exclude_workout_id: Optional workout id to exclude (e.g. the active
            workout itself, so it doesn't match against its own just-added sets)

    Returns:
        dict with the source workout_id (or null) and its sets in order.
        Warmup sets (note="Warmup", from imported history) are left out -
        the frontend matches "Previous" to today's sets by position, and a
        warmup's much lighter weight/reps isn't a meaningful comparison for
        a working set. Dropsets and to-failure sets are kept, since they're
        still real working data.
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
            ]
        }


@app.get("/exercises/progress")
def get_exercise_progress(name: str):
    """
    Get the top set weight per day for an exercise, in date order, for the
    Progress tab's strength trend chart. Matches by base name (stripping
    equipment qualifiers like "(Barbell)"), so e.g. "Romanian Deadlift" and
    "Romanian Deadlift (Barbell)" are combined into one trend line. Read-only
    - does not change how workouts are stored.

    Args:
        name: Exercise name to look up (matched by base name, case-insensitive)

    Returns:
        List of {date, weight_kg}, one entry per day with a weighted set
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
                ExerciseSet.weight_kg.isnot(None)
            ).order_by(ExerciseSet.weight_kg.desc()).first()
            if not top_set:
                continue

            date_key = started_at.date().isoformat()
            if date_key not in by_date or top_set.weight_kg > by_date[date_key]:
                by_date[date_key] = top_set.weight_kg

        return [{"date": d, "weight_kg": w} for d, w in sorted(by_date.items())]


@app.get("/exercises/custom")
def list_custom_exercises():
    """
    List all user-added custom exercise names, most recently added first.

    Returns:
        List of custom exercises with their id and name
    """
    with get_session() as session:
        rows = session.query(CustomExercise).order_by(CustomExercise.created_at.desc()).all()
        return [{"id": r.id, "name": r.name} for r in rows]


@app.post("/exercises/custom")
def create_custom_exercise(payload: CustomExerciseCreate):
    """
    Persist a user-typed exercise name so it appears in the exercise picker
    on future workouts. Idempotent by name (case-insensitive): re-adding an
    existing name returns the existing record instead of creating a duplicate.

    Args:
        payload: CustomExerciseCreate with the exercise name

    Returns:
        The created (or already-existing) custom exercise
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


# ========== Workout Suggestion Models ==========
class SuggestedExerciseResponse(BaseModel):
    """Response model for one exercise in a proposed workout."""
    name: str
    muscle_group: str
    reason: str


class KneeExerciseCreate(BaseModel):
    """Request model for adding an entry to the knee-strengthening list."""
    name: str


@app.get("/suggest-workout", response_model=List[SuggestedExerciseResponse])
def get_suggested_workout(split: Optional[str] = None):
    """
    Propose a workout for the "Recommended Workout" review screen. Every
    proposal is all upper-body or all lower-body, never mixed. On a
    lower-body day, a glute-focused exercise and a knee-strengthening
    exercise are always included. A suggestion only - the user reviews it
    and chooses whether to start it, shuffle for another, or go back.

    Args:
        split: "upper" or "lower" to pick the split yourself; omit to let
            it auto-decide based on whichever side is more neglected in the
            last 7 days (biased toward lower body for glute priority)

    Returns:
        List[SuggestedExerciseResponse]: ~4-6 proposed exercises, each with
        its target muscle group and a short reason it was picked
    """
    if split is not None and split.lower() not in ("upper", "lower"):
        raise HTTPException(status_code=400, detail="split must be 'upper' or 'lower'")

    with get_session() as session:
        return suggest_workout(session, split=split)


@app.get("/knee-exercises")
def list_knee_exercises():
    """
    List the user's knee-strengthening exercise list (editable, seeded with
    physio-given defaults on first run), most recently added first.

    Returns:
        List of knee exercises with their id and name
    """
    with get_session() as session:
        rows = session.query(KneeExercise).order_by(KneeExercise.created_at.desc()).all()
        return [{"id": r.id, "name": r.name} for r in rows]


@app.post("/knee-exercises")
def create_knee_exercise(payload: KneeExerciseCreate):
    """
    Add an entry to the knee-strengthening list. Idempotent by name
    (case-insensitive): re-adding an existing name returns the existing
    record instead of creating a duplicate.

    Args:
        payload: KneeExerciseCreate with the exercise name

    Returns:
        The created (or already-existing) knee exercise
    """
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


@app.delete("/knee-exercises/{knee_exercise_id}")
def delete_knee_exercise(knee_exercise_id: int):
    """
    Remove an entry from the knee-strengthening list.

    Args:
        knee_exercise_id: The id of the KneeExercise row to delete

    Returns:
        dict: Success message
    """
    with get_session() as session:
        db_entry = session.query(KneeExercise).filter(KneeExercise.id == knee_exercise_id).first()
        if not db_entry:
            raise HTTPException(status_code=404, detail="Knee exercise not found")

        session.delete(db_entry)
        session.commit()

        return {"message": "Knee exercise deleted successfully"}


# ========== Weekly Check-in Models ==========
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
    """Build a CheckinResponse from a WeeklyCheckin row, exposing photo_path
    as the URL the frontend can load it from (see the /photos static mount)."""
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
    """Generate a fresh timestamped path in PHOTOS_DIR for a check-in photo."""
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"checkin_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
    return os.path.join(PHOTOS_DIR, filename)


# ========== Weekly Check-in Endpoints ==========
@app.post("/checkins", response_model=CheckinResponse)
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
    """
    Save a weekly check-in: an optional progress photo, weight, body
    circumference measurements, and notes.

    Args:
        checkin_date: ISO date string (YYYY-MM-DD); defaults to today
        weight_kg, waist_cm, chest_cm, hips_cm, arm_cm, thigh_cm: optional measurements
        notes: optional reflection text
        photo: optional progress photo

    Returns:
        CheckinResponse: The saved check-in
    """
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


@app.get("/checkins", response_model=List[CheckinResponse])
def get_checkins():
    """
    Get all weekly check-ins, most recent first.

    Returns:
        List[CheckinResponse]: All check-ins ordered by date descending
    """
    with get_session() as session:
        checkins = session.query(WeeklyCheckin).order_by(
            WeeklyCheckin.checkin_date.desc(), WeeklyCheckin.created_at.desc()
        ).all()
        return [_checkin_to_response(c) for c in checkins]


@app.get("/checkins/{checkin_id}", response_model=CheckinResponse)
def get_checkin(checkin_id: int):
    """
    Get one weekly check-in.

    Args:
        checkin_id: The ID of the check-in to retrieve

    Returns:
        CheckinResponse: The check-in
    """
    with get_session() as session:
        checkin = session.query(WeeklyCheckin).filter(WeeklyCheckin.id == checkin_id).first()
        if not checkin:
            raise HTTPException(status_code=404, detail="Check-in not found")
        return _checkin_to_response(checkin)


@app.patch("/checkins/{checkin_id}", response_model=CheckinResponse)
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
    Update a weekly check-in. Sending a new photo replaces the old one
    (the previous file is removed); omitting fields leaves them unchanged.

    Args:
        checkin_id: The ID of the check-in to update
        (other args as in create_checkin)

    Returns:
        CheckinResponse: The updated check-in
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


@app.delete("/checkins/{checkin_id}")
def delete_checkin(checkin_id: int):
    """
    Delete a weekly check-in and its photo file, if any.

    Args:
        checkin_id: The ID of the check-in to delete

    Returns:
        dict: Success message
    """
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


# ========== Goal Models ==========
class GoalUpdate(BaseModel):
    """Request model for setting/updating the active goal. All fields optional -
    only set what you care about."""
    calorie_target: Optional[float] = None
    protein_target_g: Optional[float] = None
    carb_target_g: Optional[float] = None
    fat_target_g: Optional[float] = None
    training_days_per_week: Optional[int] = None
    target_weight_kg: Optional[float] = None
    target_date: Optional[str] = None  # ISO date string (YYYY-MM-DD)


class GoalResponse(BaseModel):
    """Response model for the active goal. All fields null if no goal has been set yet."""
    id: Optional[int]
    calorie_target: Optional[float]
    protein_target_g: Optional[float]
    carb_target_g: Optional[float]
    fat_target_g: Optional[float]
    training_days_per_week: Optional[int]
    target_weight_kg: Optional[float]
    target_date: Optional[str]


def _goal_to_response(goal: Optional[Goal]) -> GoalResponse:
    if goal is None:
        return GoalResponse(
            id=None, calorie_target=None, protein_target_g=None, carb_target_g=None,
            fat_target_g=None, training_days_per_week=None, target_weight_kg=None, target_date=None,
        )
    return GoalResponse(
        id=goal.id,
        calorie_target=goal.calorie_target,
        protein_target_g=goal.protein_target_g,
        carb_target_g=goal.carb_target_g,
        fat_target_g=goal.fat_target_g,
        training_days_per_week=goal.training_days_per_week,
        target_weight_kg=goal.target_weight_kg,
        target_date=goal.target_date.isoformat() if goal.target_date else None,
    )


# ========== Goal Endpoints ==========
@app.get("/goal", response_model=GoalResponse)
def get_goal():
    """
    Get the active goal, if one has been set.

    Returns:
        GoalResponse: The active goal, or all-null fields if none is set
    """
    with get_session() as session:
        goal = session.query(Goal).filter(Goal.active == True).order_by(Goal.created_at.desc()).first()  # noqa: E712
        return _goal_to_response(goal)


@app.put("/goal", response_model=GoalResponse)
def set_goal(goal_update: GoalUpdate):
    """
    Set or update the active goal. A single-user app, so this replaces
    whatever the current active goal's field values are (existing active
    goal is updated in place rather than creating a new row each time).

    Args:
        goal_update: GoalUpdate with the target fields to set

    Returns:
        GoalResponse: The saved active goal
    """
    with get_session() as session:
        goal = session.query(Goal).filter(Goal.active == True).order_by(Goal.created_at.desc()).first()  # noqa: E712
        if goal is None:
            goal = Goal(active=True)
            session.add(goal)

        goal.calorie_target = goal_update.calorie_target
        goal.protein_target_g = goal_update.protein_target_g
        goal.carb_target_g = goal_update.carb_target_g
        goal.fat_target_g = goal_update.fat_target_g
        goal.training_days_per_week = goal_update.training_days_per_week
        goal.target_weight_kg = goal_update.target_weight_kg
        if goal_update.target_date:
            try:
                goal.target_date = date.fromisoformat(goal_update.target_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="target_date must be YYYY-MM-DD")
        else:
            goal.target_date = None

        session.commit()
        session.refresh(goal)

        return _goal_to_response(goal)


# ========== Skipped Days Models ==========
class SkippedDayResponse(BaseModel):
    """Response model for a skipped day."""
    id: Optional[int]
    skip_date: str
    created_at: Optional[str]


class SkippedDayCreate(BaseModel):
    """Request model for creating a skipped day."""
    skip_date: str  # YYYY-MM-DD format


# ========== Skipped Days Endpoints ==========
@app.get("/skipped-days", response_model=List[SkippedDayResponse])
def get_skipped_days():
    """
    Get all skipped days.

    Returns:
        List[SkippedDayResponse]: List of all skipped days
    """
    with get_session() as session:
        skipped_days = session.query(DailySkippedDay).order_by(DailySkippedDay.skip_date.desc()).all()
        return [
            SkippedDayResponse(
                id=s.id,
                skip_date=s.skip_date.isoformat(),
                created_at=s.created_at.isoformat() if s.created_at else None
            )
            for s in skipped_days
        ]


@app.post("/skipped-days", response_model=SkippedDayResponse)
def create_skipped_day(skipped_day: SkippedDayCreate):
    """
    Mark a calendar date as skipped for food tracking. The date can be any
    day - today or one in the past - so a day that was never logged can
    still be marked "I didn't track this one".

    Idempotent: marking an already-skipped date just returns the existing
    record (200) rather than erroring, so the UI can treat it as a toggle.

    Args:
        skipped_day: SkippedDayCreate with the date to skip (YYYY-MM-DD)

    Returns:
        SkippedDayResponse: The skipped day record (new or pre-existing)
    """
    with get_session() as session:
        try:
            skip_date = date.fromisoformat(skipped_day.skip_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="skip_date must be YYYY-MM-DD")

        db_skipped_day = session.query(DailySkippedDay).filter(
            DailySkippedDay.skip_date == skip_date
        ).first()
        if db_skipped_day is None:
            db_skipped_day = DailySkippedDay(skip_date=skip_date)
            session.add(db_skipped_day)
            session.commit()
            session.refresh(db_skipped_day)

        return SkippedDayResponse(
            id=db_skipped_day.id,
            skip_date=db_skipped_day.skip_date.isoformat(),
            created_at=db_skipped_day.created_at.isoformat() if db_skipped_day.created_at else None
        )


@app.delete("/skipped-days/{skip_date}")
def delete_skipped_day(skip_date: str):
    """
    Remove a day from the skipped days list.

    Args:
        skip_date: The date to un-skip (YYYY-MM-DD)

    Returns:
        dict with success message
    """
    with get_session() as session:
        try:
            skip_date_obj = date.fromisoformat(skip_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="skip_date must be YYYY-MM-DD")

        skipped_day = session.query(DailySkippedDay).filter(
            DailySkippedDay.skip_date == skip_date_obj
        ).first()
        if skipped_day is not None:
            session.delete(skipped_day)
            session.commit()

        # Idempotent: un-skipping a date that isn't skipped is a no-op, not an error
        return {"message": "Skipped day removed successfully"}


# Serve saved photos (meal + check-in) - must be mounted before the "/"
# frontend catch-all below
os.makedirs(PHOTOS_DIR, exist_ok=True)
app.mount(
    path="/photos",
    app=StaticFiles(directory=PHOTOS_DIR),
    name="photos"
)

# Mount static files for frontend
app.mount(
    path="/",
    app=StaticFiles(directory=FRONTEND_DIR, html=True),
    name="frontend"
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)