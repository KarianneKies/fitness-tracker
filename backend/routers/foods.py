# routers/foods.py — Food reference search, label scan, custom products, servings, food photo

import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import case, func

from ..config import HAND_MEASUREMENTS, PHOTOS_DIR
from ..database import get_session
from ..models import Food, UserFood, FoodServing, FoodOverride
from ..vision import analyze_food_photo as vision_analyze
from ..vision import analyze_nutrition_label as vision_analyze_label

router = APIRouter(tags=["foods"])


# ========== Food photo ==========
class FoodItem(BaseModel):
    """A food item identified in a photo."""
    name: str
    estimated_portion_g: int


class FoodPhotoResponse(BaseModel):
    """Response model for food photo analysis."""
    items: List[FoodItem]
    photo_path: Optional[str] = None


@router.post("/meals/photo", response_model=FoodPhotoResponse)
async def analyze_food_photo(photo: UploadFile = File(...)):
    """
    Analyze a food photo with the vision model: save it, send it to LM
    Studio, return the recognized items with estimated portion sizes.
    """
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"meal_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
    photo_path = os.path.join(PHOTOS_DIR, filename)

    with open(photo_path, "wb") as f:
        content = await photo.read()
        f.write(content)

    items = await vision_analyze(photo_path, HAND_MEASUREMENTS)
    if items is None:
        items = []
    return FoodPhotoResponse(items=items, photo_path=photo_path)


# ========== Search ==========
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
    """Rank a description against a query: 0 = exact, 1 = prefix, 2 = other substring."""
    lower_desc = description.lower()
    lower_query = query.lower()
    if lower_desc == lower_query:
        return 0
    if lower_desc.startswith(lower_query):
        return 1
    return 2


@router.get("/foods/search", response_model=List[FoodSearchResult])
def search_foods(q: str):
    """
    Search the local food references (USDA import + user-added products) by
    description. Case-insensitive substring match; exact matches rank first,
    then prefix, then other substrings (shorter first); max 20 results.
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


# ========== Label scan / custom products ==========
class LabelScanResponse(BaseModel):
    """Values extracted from a nutrition label photo; unread fields stay None."""
    product_name: Optional[str] = None
    serving_size_g: Optional[float] = None
    calories_kcal: Optional[float] = None
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None


class CustomFoodCreate(BaseModel):
    """Request model for saving a user-reviewed custom product (per-100g macros)."""
    description: str
    calories_kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


@router.post("/foods/label-scan", response_model=LabelScanResponse)
async def scan_nutrition_label(photo: UploadFile = File(...)):
    """
    Transcribe a nutrition label photo (name + serving + per-serving macros)
    for the user to review. Never estimates; all-null on failure (200 OK).
    """
    image_bytes = await photo.read()
    extracted = await vision_analyze_label(image_bytes)
    if extracted is None:
        return LabelScanResponse()
    return LabelScanResponse(**extracted)


@router.post("/foods/custom", response_model=FoodSearchResult)
def create_custom_food(food: CustomFoodCreate):
    """Save a user-reviewed custom product to the local reference (UserFood)."""
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


@router.patch("/foods/custom/{food_id}", response_model=FoodSearchResult)
def update_custom_food(food_id: int, food: CustomFoodCreate):
    """Update a custom product's name and/or per-100g macros."""
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


@router.delete("/foods/custom/{food_id}")
def delete_custom_food(food_id: int):
    """Delete a custom product (and any servings defined for it)."""
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


@router.patch("/foods/usda/{food_id}", response_model=FoodSearchResult)
def update_usda_food(food_id: int, food: CustomFoodCreate):
    """
    Save a correction to a USDA food's name/macros as a separate override row
    (import_usda.py reloads the Food table, so a direct edit would vanish).
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
            override = FoodOverride(
                food_id=food_id, food_source="usda", description=description,
                calories_kcal=food.calories_kcal, protein_g=food.protein_g,
                carbs_g=food.carbs_g, fat_g=food.fat_g,
            )
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


@router.delete("/foods/usda/{food_id}/override")
def reset_usda_food(food_id: int):
    """Discard a correction and revert a USDA food to its imported values."""
    with get_session() as session:
        override = session.query(FoodOverride).filter(FoodOverride.food_id == food_id).first()
        if not override:
            raise HTTPException(status_code=404, detail="No correction exists for this food")

        session.delete(override)
        session.commit()
        return {"message": "Reverted to the original USDA values"}


# ========== Servings ==========
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


@router.post("/foods/servings", response_model=FoodServingResponse)
def create_food_serving(serving: FoodServingCreate):
    """Define a custom serving size for a food (e.g. '1 rice cake = 9g')."""
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


@router.get("/foods/servings", response_model=List[FoodServingResponse])
def list_food_servings(food_id: int, food_source: str):
    """List the servings defined for a food."""
    with get_session() as session:
        servings = session.query(FoodServing).filter(
            FoodServing.food_id == food_id, FoodServing.food_source == food_source
        ).all()
        return [FoodServingResponse(id=s.id, label=s.label, grams_per_unit=s.grams_per_unit) for s in servings]


@router.patch("/foods/servings/{serving_id}", response_model=FoodServingResponse)
def update_food_serving(serving_id: int, serving: FoodServingUpdate):
    """Update a serving's label and/or grams per unit."""
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


@router.delete("/foods/servings/{serving_id}")
def delete_food_serving(serving_id: int):
    """Delete a custom serving size."""
    with get_session() as session:
        serving = session.query(FoodServing).filter(FoodServing.id == serving_id).first()
        if not serving:
            raise HTTPException(status_code=404, detail="Serving not found")

        session.delete(serving)
        session.commit()
        return {"message": "Serving deleted successfully"}
