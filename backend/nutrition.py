# nutrition.py — Look up + scale macros from local USDA database (photo source)

"""
Nutrition module for looking up food data from the local USDA FoodData Central
database and scaling macros to portion sizes.

Functions:
- lookup_food_by_name: Find a food in the USDA DB by name
- scale_macros: Calculate macros for a given portion size
"""

from typing import Dict, Optional


def lookup_food_by_name(name: str) -> Optional[Dict]:
    """
    Look up a food item in the local USDA FoodData Central database.
    
    Args:
        name: The common name of the food to search for
        
    Returns:
        A dictionary containing food data (id, name, fdc_id, per-100g macros)
        or None if not found.
        
    TODO: Implement USDA database lookup after data import is complete.
    """
    raise NotImplementedError("lookup_food_by_name not implemented yet")


def scale_macros(per_100g: Dict, portion_g: float) -> Dict:
    """
    Scale per-100g macros to a given portion size.
    
    Args:
        per_100g: Dictionary with 'calories', 'protein_g', 'carbs_g', 'fat_g'
        portion_g: The actual portion size in grams
        
    Returns:
        Dictionary with macros scaled to the portion size.
        
    TODO: Implement macro scaling logic.
    """
    raise NotImplementedError("scale_macros not implemented yet")