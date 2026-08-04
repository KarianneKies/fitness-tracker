# models.py — SQLModel definitions for Fitness Tracker

"""
SQLModel definitions for the Fitness Tracker application.

This module defines all database models:
- Workout: A complete workout session with start/end times
- Exercise: An exercise performed during a workout (e.g., "Bench Press")
- ExerciseSet: A single set of an exercise with reps, weight, rest
- Meal: Meal records containing multiple food items
- FoodItem: Individual food entries with nutrition data
- WeeklyCheckin: Weekly progress and reflection entries
- Goal: User goals (weight, strength, etc.)
- DailyEvaluation: Daily habit and mood evaluation
- Food: USDA FoodData Central food reference (per-100g macros)
- UserFood: User-added food reference (e.g. scanned from a nutrition label)
"""

from datetime import date, datetime
from typing import List, Optional

from sqlmodel import Field, Relationship, SQLModel


class Food(SQLModel, table=True):
    """
    Model for a USDA FoodData Central food reference.

    One row per food, holding per-100g macros used to look up nutrition
    when logging a meal from a photo.
    """
    __tablename__ = "foods"

    id: Optional[int] = Field(default=None, primary_key=True)
    fdc_id: int = Field(..., unique=True, index=True, description="USDA FoodData Central ID")
    description: str = Field(..., index=True, description="Food name/description")
    calories_kcal: float = Field(..., description="Energy in kcal per 100g")
    protein_g: float = Field(..., description="Protein in grams per 100g")
    carbs_g: float = Field(..., description="Carbohydrate in grams per 100g")
    fat_g: float = Field(..., description="Total fat in grams per 100g")


class UserFood(SQLModel, table=True):
    """
    Model for a user-added food reference (e.g. scanned from a nutrition
    label photo and reviewed/corrected by the user).

    Kept in a separate table from Food (the USDA import) so user-added
    products are never wiped out when the USDA dataset is re-imported.
    """
    __tablename__ = "user_foods"

    id: Optional[int] = Field(default=None, primary_key=True)
    description: str = Field(..., index=True, description="Product name")
    calories_kcal: float = Field(..., description="Energy in kcal per 100g")
    protein_g: float = Field(..., description="Protein in grams per 100g")
    carbs_g: float = Field(..., description="Carbohydrate in grams per 100g")
    fat_g: float = Field(..., description="Total fat in grams per 100g")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class Workout(SQLModel, table=True):
    """
    Model for a complete workout session.
    
    Each record represents one workout session with start/end times.
    Exercises and sets are nested under workouts.
    """
    __tablename__ = "workouts"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow, description="When the workout started")
    finished_at: Optional[datetime] = Field(default=None, description="When the workout ended (nullable if active)")
    duration_seconds: Optional[int] = Field(default=None, description="Total workout duration in seconds")
    name: Optional[str] = Field(default=None, description="Name/title of the workout (e.g., 'Push', 'Lower A')")
    notes: Optional[str] = Field(default=None, description="Notes about the workout")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")
    
    # Relationship to exercises
    exercises: Optional[List["Exercise"]] = Relationship(
        back_populates="workout",
        sa_relationship_kwargs={"lazy": "dynamic"}
    )


class Exercise(SQLModel, table=True):
    """
    Model for an exercise performed during a workout.
    
    Each record represents one exercise (like "Bench Press") within a specific workout.
    """
    __tablename__ = "exercises"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    workout_id: int = Field(..., foreign_key="workouts.id", description="Reference to the parent workout")
    name: str = Field(..., description="Exercise name (e.g., 'Bench Press')")
    order: int = Field(..., description="Position/order of this exercise within the workout")
    muscle_group: Optional[str] = Field(default=None, description="Primary muscle group worked (e.g., 'Chest'), guessed from the exercise name")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")

    # Relationship back to workout
    workout: Optional["Workout"] = Relationship(back_populates="exercises")


class ExerciseSet(SQLModel, table=True):
    """
    Model for a single set of an exercise.
    
    Each record represents one set with reps, weight, rest time, and optional note.
    """
    __tablename__ = "exercise_sets"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    exercise_id: int = Field(..., foreign_key="exercises.id", description="Reference to the parent exercise")
    order: int = Field(..., description="Position/order of this set within the exercise")
    reps: Optional[int] = Field(default=None, description="Number of repetitions")
    weight_kg: Optional[float] = Field(default=None, description="Weight used in kilograms")
    hold_seconds: Optional[int] = Field(default=None, description="Hold duration in seconds (for time-based exercises like planks)")
    to_failure: bool = Field(default=False, description="Whether this set was taken to muscular failure")
    rest_seconds: Optional[int] = Field(default=None, description="Rest time after this set (in seconds)")
    note: Optional[str] = Field(default=None, description="Optional note about this set")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class Meal(SQLModel, table=True):
    """
    Model for meal records.
    
    A meal can contain multiple food items. Each meal represents one eating occasion.
    """
    __tablename__ = "meals"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(..., description="Meal name (e.g., 'Breakfast', 'Lunch')")
    meal_date: date = Field(default_factory=lambda: date.today(), description="Date of the meal")
    meal_time: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Time of eating")
    notes: Optional[str] = Field(default=None, description="Notes about the meal")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class FoodItem(SQLModel, table=True):
    """
    Model for individual food items within a meal.
    
    Each record represents one food item with its nutritional content.
    """
    __tablename__ = "food_items"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    meal_id: int = Field(..., foreign_key="meals.id", description="Reference to the parent meal")
    name: str = Field(..., description="Food name (e.g., 'Chicken Breast')")
    quantity: float = Field(..., description="Quantity consumed (grams, for source='search')")
    unit: str = Field(default="g", description="Unit of measurement (e.g., 'g', 'cup', 'oz')")
    calories: Optional[float] = Field(default=None, description="Calories in this food item")
    protein_g: Optional[float] = Field(default=None, description="Protein in grams")
    carbs_g: Optional[float] = Field(default=None, description="Carbohydrates in grams")
    fat_g: Optional[float] = Field(default=None, description="Fat in grams")
    barcode: Optional[str] = Field(default=None, description="Barcode if scanned from product")
    source: Optional[str] = Field(default=None, description="Where this item came from: 'search', 'photo', or 'barcode'")
    fdc_id: Optional[int] = Field(default=None, description="USDA FoodData Central ID, for source='search' or 'photo'")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class WeeklyCheckin(SQLModel, table=True):
    """
    Model for weekly progress check-ins.

    Records a progress photo, weight, and body circumference measurements,
    for tracking physical change over time (SPEC.md section 5).
    """
    __tablename__ = "weekly_checkins"

    id: Optional[int] = Field(default=None, primary_key=True)
    checkin_date: date = Field(default_factory=lambda: date.today(), description="Date of the check-in")
    photo_path: Optional[str] = Field(default=None, description="Path to the progress photo, if taken")
    weight_kg: Optional[float] = Field(default=None, description="Weight in kilograms")
    waist_cm: Optional[float] = Field(default=None, description="Waist circumference in cm")
    chest_cm: Optional[float] = Field(default=None, description="Chest circumference in cm")
    hips_cm: Optional[float] = Field(default=None, description="Hips circumference in cm")
    arm_cm: Optional[float] = Field(default=None, description="Arm circumference in cm")
    thigh_cm: Optional[float] = Field(default=None, description="Thigh circumference in cm")
    notes: Optional[str] = Field(default=None, description="Weekly reflection or notes")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class Goal(SQLModel, table=True):
    """
    Model for the user's active goal: daily nutrition targets and an
    optional longer-term body goal (SPEC.md section 5). A single-user app,
    so there is one active goal at a time; setting a new one replaces it.
    """
    __tablename__ = "goals"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")
    active: bool = Field(default=True, description="Whether this is the currently active goal")

    # Daily nutrition targets (all nullable - set what you care about)
    calorie_target: Optional[float] = Field(default=None, description="Daily calorie target (kcal)")
    protein_target_g: Optional[float] = Field(default=None, description="Daily protein target (g)")
    carb_target_g: Optional[float] = Field(default=None, description="Daily carbohydrate target (g)")
    fat_target_g: Optional[float] = Field(default=None, description="Daily fat target (g)")

    # Optional exercise target
    training_days_per_week: Optional[int] = Field(default=None, description="Target training days per week")

    # Optional body goal
    target_weight_kg: Optional[float] = Field(default=None, description="Target body weight (kg)")
    target_date: Optional[date] = Field(default=None, description="Target date for the body goal")


class DailyEvaluation(SQLModel, table=True):
    """
    Model for daily habit and mood evaluation.
    
    Tracks energy levels, mood, and habit completion each day.
    """
    __tablename__ = "daily_evaluations"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    eval_date: date = Field(default_factory=lambda: date.today(), description="Date of evaluation")
    energy_level: Optional[int] = Field(default=None, ge=1, le=10, description="Energy level 1-10")
    mood: Optional[int] = Field(default=None, ge=1, le=10, description="Mood rating 1-10")
    sleep_hours: Optional[float] = Field(default=None, description="Hours of sleep")
    habits_completed: Optional[int] = Field(default=None, description="Number of habits completed")
    total_habits: Optional[int] = Field(default=None, description="Total number of habits tracked")
    notes: Optional[str] = Field(default=None, description="Notes about the day")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")