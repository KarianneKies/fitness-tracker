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
- GET /foods/search: Search local food references (USDA + user-added) by description
- POST /foods/label-scan: Extract product name/macros from a nutrition label photo
- POST /foods/custom: Save a user-reviewed custom product
- POST /meals: Save a meal with its food items (e.g. from manual food search)
- GET /meals: List all meals with their food items and totals
- GET /meals/{id}: Get one meal with all food items and totals
- PATCH /meals/{id}: Update a meal (name, date, add/edit/remove food items)
- DELETE /meals/{id}: Delete a meal
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
import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import case, func

from .config import FRONTEND_DIR, PHOTOS_DIR, HAND_MEASUREMENTS
from .database import create_db_and_tables, get_session
from .models import Workout, Exercise, ExerciseSet, Food, UserFood, Meal, FoodItem as FoodItemModel, WeeklyCheckin, Goal
from .vision import analyze_food_photo as vision_analyze
from .vision import analyze_nutrition_label as vision_analyze_label


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


# Temporary diagnostic logging for 422s on upload endpoints - a real device
# has been hitting "Field required" on /foods/label-scan with no obvious
# client-side cause; this logs exactly what the server actually received so
# the next occurrence is diagnosable instead of a guess. Safe to remove once
# that's root-caused - it only logs, it doesn't change any response.
@app.exception_handler(RequestValidationError)
async def log_validation_errors(request: Request, exc: RequestValidationError):
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


# ========== Food Search Models ==========
class FoodSearchResult(BaseModel):
    """A food reference match (USDA or user-added), with per-100g macros."""
    id: int
    description: str
    calories_kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    source: str  # "usda" or "custom"


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
async def search_foods(q: str):
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

        results = [
            FoodSearchResult(
                id=food.id,
                description=food.description,
                calories_kcal=food.calories_kcal,
                protein_g=food.protein_g,
                carbs_g=food.carbs_g,
                fat_g=food.fat_g,
                source="usda",
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
async def create_custom_food(food: CustomFoodCreate):
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


class MealCreate(BaseModel):
    """Request model for saving a meal with its food items."""
    name: Optional[str] = None
    meal_date: Optional[str] = None  # ISO date string (YYYY-MM-DD); defaults to today
    items: List[MealFoodItemCreate]


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


class MealResponse(BaseModel):
    """Response model for a saved meal, with its items and totals."""
    id: int
    name: str
    meal_date: str
    items: List[MealFoodItemResponse]
    total_calories: float
    total_protein_g: float
    total_carbs_g: float
    total_fat_g: float


# ========== Meal Endpoints ==========
@app.post("/meals", response_model=MealResponse)
async def create_meal(meal: MealCreate):
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
        if meal.meal_date:
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
            ))
            total_calories += item.calories
            total_protein_g += item.protein_g
            total_carbs_g += item.carbs_g
            total_fat_g += item.fat_g

        return MealResponse(
            id=db_meal.id,
            name=db_meal.name,
            meal_date=db_meal.meal_date.isoformat(),
            items=items_response,
            total_calories=total_calories,
            total_protein_g=total_protein_g,
            total_carbs_g=total_carbs_g,
            total_fat_g=total_fat_g,
        )


@app.get("/meals", response_model=List[MealResponse])
async def get_meals():
    """
    Get all meals, most recent first, with their food items and totals.

    Returns:
        List[MealResponse]: All meals with items and computed totals
    """
    with get_session() as session:
        meals = session.query(Meal).order_by(Meal.created_at.desc()).all()

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
                )
                for item in items
            ]

            result.append(MealResponse(
                id=db_meal.id,
                name=db_meal.name,
                meal_date=db_meal.meal_date.isoformat(),
                items=items_response,
                total_calories=sum(i.calories or 0 for i in items),
                total_protein_g=sum(i.protein_g or 0 for i in items),
                total_carbs_g=sum(i.carbs_g or 0 for i in items),
                total_fat_g=sum(i.fat_g or 0 for i in items),
            ))

        return result


# ========== Meal Detail Endpoints ==========
@app.get("/meals/{meal_id}", response_model=MealResponse)
async def get_meal(meal_id: int):
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
            )
            for item in items
        ]

        return MealResponse(
            id=db_meal.id,
            name=db_meal.name,
            meal_date=db_meal.meal_date.isoformat(),
            items=items_response,
            total_calories=sum(i.calories or 0 for i in items),
            total_protein_g=sum(i.protein_g or 0 for i in items),
            total_carbs_g=sum(i.carbs_g or 0 for i in items),
            total_fat_g=sum(i.fat_g or 0 for i in items),
        )


@app.patch("/meals/{meal_id}", response_model=MealResponse)
async def update_meal(meal_id: int, meal_update: MealCreate):
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

        # Update meal name/date if provided
        if meal_update.name is not None:
            db_meal.name = meal_update.name
        if meal_update.meal_date:
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
            )
            for item in items
        ]

        return MealResponse(
            id=db_meal.id,
            name=db_meal.name,
            meal_date=db_meal.meal_date.isoformat(),
            items=items_response,
            total_calories=sum(i.calories or 0 for i in items),
            total_protein_g=sum(i.protein_g or 0 for i in items),
            total_carbs_g=sum(i.carbs_g or 0 for i in items),
            total_fat_g=sum(i.fat_g or 0 for i in items),
        )


@app.delete("/meals/{meal_id}")
async def delete_meal(meal_id: int):
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


@app.delete("/workouts/{workout_id}")
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
async def get_checkins():
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
async def get_checkin(checkin_id: int):
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
async def delete_checkin(checkin_id: int):
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
async def get_goal():
    """
    Get the active goal, if one has been set.

    Returns:
        GoalResponse: The active goal, or all-null fields if none is set
    """
    with get_session() as session:
        goal = session.query(Goal).filter(Goal.active == True).order_by(Goal.created_at.desc()).first()  # noqa: E712
        return _goal_to_response(goal)


@app.put("/goal", response_model=GoalResponse)
async def set_goal(goal_update: GoalUpdate):
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