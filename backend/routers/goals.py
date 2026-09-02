# routers/goals.py — The single active goal

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_session
from ..models import Goal

router = APIRouter(tags=["goal"])


class GoalUpdate(BaseModel):
    """Request model for setting/updating the active goal. All fields optional."""
    calorie_target: Optional[float] = None
    protein_target_g: Optional[float] = None
    carb_target_g: Optional[float] = None
    fat_target_g: Optional[float] = None
    training_days_per_week: Optional[int] = None
    target_weight_kg: Optional[float] = None
    target_date: Optional[str] = None  # ISO date string (YYYY-MM-DD)


class GoalResponse(BaseModel):
    """Response model for the active goal. All fields null if none set yet."""
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


def _active_goal(session):
    return session.query(Goal).filter(Goal.active == True).order_by(  # noqa: E712
        Goal.created_at.desc()
    ).first()


@router.get("/goal", response_model=GoalResponse)
def get_goal():
    """Get the active goal, or all-null fields if none is set."""
    with get_session() as session:
        return _goal_to_response(_active_goal(session))


@router.put("/goal", response_model=GoalResponse)
def set_goal(goal_update: GoalUpdate):
    """
    Set or update the active goal. Single-user app: the existing active goal
    row is updated in place rather than creating a new one each time.
    """
    with get_session() as session:
        goal = _active_goal(session)
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
