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
"""

from datetime import date, datetime
from typing import Optional

from sqlmodel import Field, SQLModel


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
    notes: Optional[str] = Field(default=None, description="Notes about the workout")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


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
    quantity: float = Field(..., description="Quantity consumed")
    unit: str = Field(default="g", description="Unit of measurement (e.g., 'g', 'cup', 'oz')")
    calories: Optional[int] = Field(default=None, description="Calories in this food item")
    protein_g: Optional[float] = Field(default=None, description="Protein in grams")
    carbs_g: Optional[float] = Field(default=None, description="Carbohydrates in grams")
    fat_g: Optional[float] = Field(default=None, description="Fat in grams")
    barcode: Optional[str] = Field(default=None, description="Barcode if scanned from product")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class WeeklyCheckin(SQLModel, table=True):
    """
    Model for weekly progress check-ins.
    
    Records weekly weight, measurements, and reflections.
    """
    __tablename__ = "weekly_checkins"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    checkin_date: date = Field(default_factory=lambda: date.today(), description="Week reference date (typically Sunday)")
    weight_kg: Optional[float] = Field(default=None, description="Weight in kilograms")
    body_fat_pct: Optional[float] = Field(default=None, description="Body fat percentage")
    notes: Optional[str] = Field(default=None, description="Weekly reflection or notes")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")


class Goal(SQLModel, table=True):
    """
    Model for user goals.
    
    Goals can be weight-related, strength-based, or habit tracking.
    """
    __tablename__ = "goals"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(..., description="Goal title (e.g., 'Lose 5kg', 'Run 5k')")
    description: Optional[str] = Field(default=None, description="Detailed goal description")
    target_value: Optional[float] = Field(default=None, description="Target numeric value")
    current_value: Optional[float] = Field(default=None, description="Current progress toward target")
    unit: str = Field(default="", description="Unit of measurement for the goal")
    due_date: Optional[date] = Field(default=None, description="Target completion date")
    is_active: bool = Field(default=True, description="Whether the goal is still active")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of record creation")
    updated_at: Optional[datetime] = Field(default=None, description="Last update timestamp")


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