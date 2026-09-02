# routers/meals.py — Meals, the by-day nutrition diary, and reusable meal templates

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_session
from ..models import (
    Meal,
    FoodItem as FoodItemModel,
    MealTemplate,
    MealTemplateItem,
)

router = APIRouter(tags=["meals"])


# ========== Models ==========
class MealFoodItemCreate(BaseModel):
    """A food item to add to a meal, macros already scaled to the eaten portion."""
    id: Optional[int] = None  # existing FoodItem id, for updates
    fdc_id: Optional[int] = None
    name: str
    grams: float
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_label: Optional[str] = None
    serving_count: Optional[float] = None


class MealCreate(BaseModel):
    """Request model for saving/updating a meal with its food items."""
    name: Optional[str] = None
    meal_date: Optional[str] = None  # YYYY-MM-DD; defaults to today. Ignored if meal_time is given.
    meal_time: Optional[str] = None  # ISO datetime; its date also becomes meal_date.
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


def _parse_meal_time(value: str) -> datetime:
    """Parse a meal_time ISO datetime string, 400 on malformed input."""
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="meal_time must be an ISO datetime, e.g. 2026-08-15T19:30")


def _item_to_response(item: FoodItemModel) -> MealFoodItemResponse:
    return MealFoodItemResponse(
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


def _serialize_meal(meal: Meal, items: List[FoodItemModel]) -> MealResponse:
    """Build a MealResponse with totals summed from its items."""
    return MealResponse(
        id=meal.id,
        name=meal.name,
        meal_date=meal.meal_date.isoformat(),
        meal_time=meal.meal_time.isoformat() if meal.meal_time else None,
        items=[_item_to_response(i) for i in items],
        total_calories=sum(i.calories or 0 for i in items),
        total_protein_g=sum(i.protein_g or 0 for i in items),
        total_carbs_g=sum(i.carbs_g or 0 for i in items),
        total_fat_g=sum(i.fat_g or 0 for i in items),
    )


def _meal_items(session, meal_id: int) -> List[FoodItemModel]:
    return session.query(FoodItemModel).filter(FoodItemModel.meal_id == meal_id).all()


# ========== Meal endpoints ==========
@router.post("/meals", response_model=MealResponse)
def create_meal(meal: MealCreate):
    """
    Save a meal with its food items. Each item is stored with grams in
    `quantity` (unit "g") and the macros the caller already computed.
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

        return _serialize_meal(db_meal, _meal_items(session, db_meal.id))


@router.get("/meals", response_model=List[MealResponse])
def get_meals():
    """
    All meals, most recent first by meal_date (the day the meal is for, not
    created_at). Same-day meals are ordered by created_at as a tiebreak.
    """
    with get_session() as session:
        meals = session.query(Meal).order_by(Meal.meal_date.desc(), Meal.created_at.desc()).all()
        return [_serialize_meal(m, _meal_items(session, m.id)) for m in meals]


@router.get("/nutrition/by-day")
def get_nutrition_by_day():
    """
    Meals grouped by calendar date, most recent first. Each day includes its
    total macros and the list of meals with their items and per-meal totals.
    """
    with get_session() as session:
        meals = session.query(Meal).order_by(
            Meal.meal_date.desc(), Meal.created_at.desc()
        ).all()

        days_dict = {}
        for db_meal in meals:
            meal_date_str = db_meal.meal_date.isoformat()
            if meal_date_str not in days_dict:
                days_dict[meal_date_str] = {
                    "date": meal_date_str,
                    "meals": [],
                    "daily_totals": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
                }

            items = _meal_items(session, db_meal.id)
            meal_calories = sum(i.calories or 0 for i in items)
            meal_protein_g = sum(i.protein_g or 0 for i in items)
            meal_carbs_g = sum(i.carbs_g or 0 for i in items)
            meal_fat_g = sum(i.fat_g or 0 for i in items)

            days_dict[meal_date_str]["meals"].append({
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
                "total_fat_g": meal_fat_g,
            })

            days_dict[meal_date_str]["daily_totals"]["calories"] += meal_calories
            days_dict[meal_date_str]["daily_totals"]["protein_g"] += meal_protein_g
            days_dict[meal_date_str]["daily_totals"]["carbs_g"] += meal_carbs_g
            days_dict[meal_date_str]["daily_totals"]["fat_g"] += meal_fat_g

        return list(days_dict.values())


@router.get("/meals/{meal_id}", response_model=MealResponse)
def get_meal(meal_id: int):
    """Get one meal with all food items and totals."""
    with get_session() as session:
        db_meal = session.query(Meal).filter(Meal.id == meal_id).first()
        if not db_meal:
            raise HTTPException(status_code=404, detail="Meal not found")
        return _serialize_meal(db_meal, _meal_items(session, meal_id))


@router.patch("/meals/{meal_id}", response_model=MealResponse)
def update_meal(meal_id: int, meal_update: MealCreate):
    """Update a meal, including adding/removing/changing its food items."""
    with get_session() as session:
        db_meal = session.query(Meal).filter(Meal.id == meal_id).first()
        if not db_meal:
            raise HTTPException(status_code=404, detail="Meal not found")

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

        if meal_update.items is not None:
            kept_item_ids = set()
            for item_data in meal_update.items:
                db_item = None
                if item_data.id is not None:
                    db_item = session.query(FoodItemModel).filter(
                        FoodItemModel.id == item_data.id,
                        FoodItemModel.meal_id == meal_id,
                    ).first()

                if db_item is None:
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

            session.query(FoodItemModel).filter(
                FoodItemModel.meal_id == meal_id,
                FoodItemModel.id.not_in(kept_item_ids),
            ).delete(synchronize_session=False)
            session.commit()

        return _serialize_meal(db_meal, _meal_items(session, meal_id))


@router.delete("/meals/{meal_id}")
def delete_meal(meal_id: int):
    """Delete a meal and all its food items."""
    with get_session() as session:
        meal = session.query(Meal).filter(Meal.id == meal_id).first()
        if not meal:
            raise HTTPException(status_code=404, detail="Meal not found")

        session.query(FoodItemModel).filter(
            FoodItemModel.meal_id == meal_id
        ).delete(synchronize_session=False)
        session.delete(meal)
        session.commit()
        return {"message": "Meal deleted successfully"}


# ========== Meal templates ==========
class MealTemplateItemCreate(BaseModel):
    """A food item to save into a meal template, macros scaled to the saved portion."""
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


def _template_items(session, template_id: int) -> List[MealTemplateItem]:
    return session.query(MealTemplateItem).filter(
        MealTemplateItem.template_id == template_id
    ).order_by(MealTemplateItem.id).all()


@router.post("/meal-templates", response_model=MealTemplateResponse)
def create_meal_template(template: MealTemplateCreate):
    """Save a reusable named combination of food items."""
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

        for item in template.items:
            session.add(MealTemplateItem(
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
            ))
        session.commit()

        return _meal_template_response(db_template, _template_items(session, db_template.id))


@router.patch("/meal-templates/{template_id}", response_model=MealTemplateResponse)
def update_meal_template(template_id: int, template: MealTemplateCreate):
    """Update a template's name and items (items are fully replaced)."""
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

        session.query(MealTemplateItem).filter(
            MealTemplateItem.template_id == template_id
        ).delete(synchronize_session=False)
        session.commit()

        for item in template.items:
            session.add(MealTemplateItem(
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
            ))
        session.commit()

        return _meal_template_response(db_template, _template_items(session, template_id))


@router.get("/meal-templates", response_model=List[MealTemplateResponse])
def list_meal_templates():
    """All saved meal templates with items and totals, alphabetical by name."""
    with get_session() as session:
        templates = session.query(MealTemplate).order_by(MealTemplate.name).all()
        return [_meal_template_response(t, _template_items(session, t.id)) for t in templates]


@router.delete("/meal-templates/{template_id}")
def delete_meal_template(template_id: int):
    """Delete a meal template and its items."""
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
