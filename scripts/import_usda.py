# import_usda.py — One-off importer for USDA FoodData Central Foundation Foods
#
# Reads FoodData_Central_foundation_food_csv_2026-04-30/{food,food_nutrient}.csv
# and loads the ~469 "foundation_food" records into app.db as Food rows, reusing
# the same models and DB setup as the running app (backend/database.py,
# backend/config.py — writes to PROJECT_ROOT/app.db, not a new file).
#
# Usage: python3 import_usda.py

import csv
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # repo root (scripts/ is one level down)
USDA_DIR = REPO_ROOT / "FoodData_Central_foundation_food_csv_2026-04-30"
FOOD_CSV = USDA_DIR / "food.csv"
FOOD_NUTRIENT_CSV = USDA_DIR / "food_nutrient.csv"

sys.path.insert(0, str(REPO_ROOT))

from backend.database import create_db_and_tables, get_session
from backend.models import Food

# nutrient_id -> Food field name, per USDA nutrient.csv.
# Energy has three possible sources; most Foundation Foods only carry 2047 or
# 2048, not 1008. ENERGY_PRIORITY picks the best one available per food.
NUTRIENT_ID_MAP = {
    1008: "calories_kcal",  # Energy (KCAL)
    2047: "calories_kcal",  # Energy, Atwater General Factors (KCAL)
    2048: "calories_kcal",  # Energy, Atwater Specific Factors (KCAL)
    1003: "protein_g",      # Protein (G)
    1005: "carbs_g",        # Carbohydrate, by difference (G)
    1004: "fat_g",          # Total lipid (fat) (G)
}
ENERGY_PRIORITY = (1008, 2047, 2048)


def load_foundation_foods():
    """Read food.csv, keep only data_type == 'foundation_food' rows.

    Returns dict: fdc_id (int) -> description (str)
    """
    foods = {}
    with open(FOOD_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["data_type"] == "foundation_food":
                foods[int(row["fdc_id"])] = row["description"]
    return foods


def load_nutrient_amounts(fdc_ids):
    """Read food_nutrient.csv, extract raw amounts for the tracked nutrient
    ids for the given set of fdc_ids.

    Returns dict: fdc_id (int) -> dict of nutrient_id (int) -> amount (float)
    """
    amounts = {}
    with open(FOOD_NUTRIENT_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            fdc_id = int(row["fdc_id"])
            if fdc_id not in fdc_ids:
                continue
            nutrient_id = int(row["nutrient_id"])
            if nutrient_id not in NUTRIENT_ID_MAP:
                continue
            amount = float(row["amount"]) if row["amount"] else 0.0
            amounts.setdefault(fdc_id, {})[nutrient_id] = amount
    return amounts


def resolve_macros(nutrient_amounts):
    """Turn raw nutrient_id -> amount readings into the four Food macro
    fields: pick the first available energy source by priority, and clamp
    every value to zero (USDA's "by difference" carbs can be slightly
    negative due to rounding).

    Returns dict of Food macro field -> float
    """
    calories_kcal = 0.0
    for nutrient_id in ENERGY_PRIORITY:
        if nutrient_id in nutrient_amounts:
            calories_kcal = nutrient_amounts[nutrient_id]
            break

    return {
        "calories_kcal": max(calories_kcal, 0.0),
        "protein_g": max(nutrient_amounts.get(1003, 0.0), 0.0),
        "carbs_g": max(nutrient_amounts.get(1005, 0.0), 0.0),
        "fat_g": max(nutrient_amounts.get(1004, 0.0), 0.0),
    }


def main():
    create_db_and_tables()

    with get_session() as session:
        existing = session.query(Food).delete(synchronize_session=False)
        session.commit()
        if existing:
            print(f"Cleared {existing} existing Food rows.")

        foundation_foods = load_foundation_foods()
        nutrient_amounts_by_fdc_id = load_nutrient_amounts(set(foundation_foods.keys()))

        imported = 0
        with_calories = 0
        for fdc_id, description in foundation_foods.items():
            macros = resolve_macros(nutrient_amounts_by_fdc_id.get(fdc_id, {}))
            food = Food(
                fdc_id=fdc_id,
                description=description,
                calories_kcal=macros["calories_kcal"],
                protein_g=macros["protein_g"],
                carbs_g=macros["carbs_g"],
                fat_g=macros["fat_g"],
            )
            session.add(food)
            imported += 1
            if macros["calories_kcal"] > 0:
                with_calories += 1
        session.commit()

    print(f"Imported {imported} foods from {FOOD_CSV.parent.name}")
    print(f"  {with_calories} with calories > 0, {imported - with_calories} still at 0")


if __name__ == "__main__":
    main()
