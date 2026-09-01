# models.py — SQLModel definitions for Fitness Tracker

"""
SQLModel definitions for the Fitness Tracker application.

This module defines all database models:
- Workout: A complete workout session with start/end times
- Exercise: An exercise performed during a workout (e.g., "Bench Press")
- CustomExercise: A user-added exercise name, persisted for reuse in the picker
- KneeExercise: An entry in the user's editable knee-strengthening exercise list
- ExerciseSet: A single set of an exercise with reps, weight, rest
- Meal: Meal records containing multiple food items
- FoodItem: Individual food entries with nutrition data
- MealTemplate: A reusable named combination of food items, saved for logging again later
- MealTemplateItem: A food item within a meal template
- WeeklyCheckin: Weekly progress and reflection entries
- Goal: User goals (weight, strength, etc.)
- DailyEvaluation: Daily habit and mood evaluation
- Food: USDA FoodData Central food reference (per-100g macros)
- UserFood: User-added food reference (e.g. scanned from a nutrition label)
- FoodServing: A custom serving size for a food (e.g. "1 rice cake = 9g")
- FoodOverride: A user-edited correction to a USDA food's name/macros
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


class FoodServing(SQLModel, table=True):
    """
    Model for a custom serving size defined for a food (e.g. "1 rice cake =
    9g"), so amounts can be logged as a count of servings instead of grams.

    food_id/food_source together identify the food, since it may live in
    either the Food (USDA) or UserFood (custom) table - there's no single
    table to put a plain foreign key on.
    """
    __tablename__ = "food_servings"

    id: Optional[int] = Field(default=None, primary_key=True)
    food_id: int = Field(..., index=True, description="id of the food in its source table")
    food_source: str = Field(..., description="'usda' (Food table) or 'custom' (UserFood table)")
    label: str = Field(..., description="Serving name, e.g. 'rice cake', 'slice', 'cup'")
    grams_per_unit: float = Field(..., description="Grams in one unit of this serving")


class FoodOverride(SQLModel, table=True):
    """
    A user-edited correction to a USDA food's name/macros.

    The Food table is wiped and reloaded every time import_usda.py runs, so
    edits can't live there - they'd vanish on the next re-import. This table
    is never touched by that script, so an override survives it; search
    results apply it on top of the base Food row when one exists.
    """
    __tablename__ = "food_overrides"

    id: Optional[int] = Field(default=None, primary_key=True)
    food_id: int = Field(..., index=True, unique=True, description="id of the Food row being corrected")
    food_source: str = Field(default="usda", description="Always 'usda' today - kept for symmetry with FoodServing")
    description: str = Field(..., description="Corrected food name")
    calories_kcal: float = Field(..., description="Corrected energy in kcal per 100g")
    protein_g: float = Field(..., description="Corrected protein in grams per 100g")
    carbs_g: float = Field(..., description="Corrected carbohydrate in grams per 100g")
    fat_g: float = Field(..., description="Corrected total fat in grams per 100g")


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


class CustomExercise(SQLModel, table=True):
    """
    Model for a user-added exercise name, typed into the exercise picker when it
    wasn't found in the built-in list. Persists so it appears in the picker on
    later workouts too.
    """
    __tablename__ = "custom_exercises"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(..., unique=True, index=True, description="Exercise name as typed by the user")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class KneeExercise(SQLModel, table=True):
    """
    Model for an entry in the user's knee-strengthening exercise list, as given
    to them by their physiotherapist. Referenced by the workout suggestion
    logic to guarantee at least one such exercise per recommendation. This is
    just a prioritized category the user defined for themselves - not a
    medical claim, and never presented as one.
    """
    __tablename__ = "knee_exercises"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(..., unique=True, index=True, description="Exercise name as it should appear in the picker")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


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
    serving_label: Optional[str] = Field(default=None, description="Serving name used to log this amount, e.g. 'rice cake' (null if logged in grams directly)")
    serving_count: Optional[float] = Field(default=None, description="How many of the serving were logged, e.g. 3 (pairs with serving_label)")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class MealTemplate(SQLModel, table=True):
    """
    A reusable named combination of food items (e.g. "Usual Salad Bar Lunch"),
    saved once and logged again later without re-searching for each item.
    Independent of any specific logged day.
    """
    __tablename__ = "meal_templates"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(..., description="Template name (e.g., 'Usual Salad Bar Lunch')")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class MealTemplateItem(SQLModel, table=True):
    """
    A single food item within a meal template, with macros already scaled to
    the saved portion (mirrors FoodItem, minus the fields tied to a specific
    logged meal).
    """
    __tablename__ = "meal_template_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    template_id: int = Field(..., foreign_key="meal_templates.id", description="Reference to the parent template")
    name: str = Field(..., description="Food name (e.g., 'Chicken Breast')")
    grams: float = Field(..., description="Quantity in grams")
    calories: Optional[float] = Field(default=None, description="Calories in this food item")
    protein_g: Optional[float] = Field(default=None, description="Protein in grams")
    carbs_g: Optional[float] = Field(default=None, description="Carbohydrates in grams")
    fat_g: Optional[float] = Field(default=None, description="Fat in grams")
    fdc_id: Optional[int] = Field(default=None, description="USDA FoodData Central ID, for reference")
    serving_label: Optional[str] = Field(default=None, description="Serving name used to log this amount, e.g. 'rice cake'")
    serving_count: Optional[float] = Field(default=None, description="How many of the serving were logged, e.g. 3 (pairs with serving_label)")


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


class DailySkippedDay(SQLModel, table=True):
    """
    Model for tracking days the user deliberately did not track food.

    A skipped day is treated as "no data" everywhere it matters: its meals
    (if any) don't count toward daily totals, and it is left out of the
    Progress charts entirely rather than being drawn as a zero-calorie day.
    One row per calendar date (skip_date is unique).
    """
    __tablename__ = "daily_skipped_days"

    id: Optional[int] = Field(default=None, primary_key=True)
    skip_date: date = Field(..., unique=True, index=True, description="Calendar date that was skipped")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")
