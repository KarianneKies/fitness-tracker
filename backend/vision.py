# vision.py — Identify foods in photos using LM Studio (OpenAI-compatible)

"""
Vision module for analyzing food photos and identifying food items using a local
LM Studio server with an OpenAI-compatible API.

Functions:
- analyze_food_photo: Send a photo to LM Studio and get food identification
- analyze_nutrition_label: Send a nutrition label photo to LM Studio and
  extract the printed product name, serving size, and per-serving macros
"""

import base64
import httpx
from typing import Dict, List, Optional

from .config import LM_STUDIO_URL, LM_STUDIO_VISION_MODEL


async def analyze_food_photo(image_path: str, hand_measurements: Optional[Dict] = None) -> Optional[List[Dict]]:
    """
    Send a food photo to LM Studio for visual analysis.
    
    Args:
        image_path: Path to the image file
        hand_measurements: Optional dict with user's hand measurements for scale reference:
            - index_finger_cm
            - hand_length_cm
            - palm_width_cm
            
    Returns:
        A list of dictionaries containing food items and their estimated portions,
        e.g., [{"name": "kip", "estimated_portion_g": 180}, {"name": "pita", "estimated_portion_g": 100}]
        or None if the call fails.
        
    LM Studio endpoint: http://localhost:3142/v1/chat/completions (OpenAI-compatible)
    """
    try:
        # Read and encode the image as base64
        with open(image_path, 'rb') as img_file:
            base64_image = base64.b64encode(img_file.read()).decode('utf-8')
        
        # Build the prompt with optional hand measurements
        prompt = """Identify all food items visible in this image. For each item, return:
1. The name of the food (short, common name)
2. An estimated portion size in grams

Return your response as a JSON array of objects with exactly these fields:
- name: string (food name)
- estimated_portion_g: integer (estimated grams)

Example output format:
[{"name": "kip", "estimated_portion_g": 180}, {"name": "pita", "estimated_portion_g": 100}]

Do NOT return any macros (calories, protein, etc.). Only identify food and estimate portions.
Be conservative with portion estimates - it's better to underestimate than overestimate."""

        if hand_measurements:
            # Add hand measurements as scale reference
            measurement_parts = []
            if hand_measurements.get("index_finger_cm"):
                measurement_parts.append(f"index finger: {hand_measurements['index_finger_cm']} cm")
            if hand_measurements.get("hand_length_cm"):
                measurement_parts.append(f"hand length: {hand_measurements['hand_length_cm']} cm")
            if hand_measurements.get("palm_width_cm"):
                measurement_parts.append(f"palm width: {hand_measurements['palm_width_cm']} cm")
            
            if measurement_parts:
                prompt += f"\n\nScale reference (user's hand measurements):\nThe image includes a hand placed next to the food for scale. The measured hand dimensions are: {', '.join(measurement_parts)}.\n\nUse these measurements as a reference for estimating portion sizes. The hand shown in the image should match these dimensions."

        # Build the OpenAI-compatible payload
        payload = {
            "model": LM_STUDIO_VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            "temperature": 0.3,
            "max_tokens": 512
        }
        
        # Send to LM Studio
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{LM_STUDIO_URL}/chat/completions",
                json=payload,
                timeout=30.0
            )
            
            if response.status_code != 200:
                print(f"LM Studio API error: {response.status_code} - {response.text}")
                return None
            
            result = response.json()
            
        # Parse the response
        if not result.get("choices") or not result["choices"][0].get("message", {}).get("content"):
            return None
            
        content = result["choices"][0]["message"]["content"].strip()
        
        # Try to parse JSON from the content
        import json
        
        # Clean up the response - extract JSON array if wrapped in markdown or other text
        json_start = content.find('[')
        json_end = content.rfind(']') + 1
        
        if json_start >= 0 and json_end > json_start:
            content = content[json_start:json_end]
        
        try:
            food_items = json.loads(content)
            
            # Validate the structure
            if isinstance(food_items, list):
                result_items = []
                for item in food_items:
                    if isinstance(item, dict) and "name" in item and "estimated_portion_g" in item:
                        result_items.append({
                            "name": str(item["name"]),
                            "estimated_portion_g": int(item["estimated_portion_g"])
                        })
                return result_items
                
        except json.JSONDecodeError:
            print(f"Failed to parse LM Studio response as JSON: {content}")
            
        return None
        
    except FileNotFoundError:
        print(f"Image file not found: {image_path}")
        return None
    except Exception as e:
        print(f"Error analyzing food photo: {e}")
        return None


async def analyze_nutrition_label(image_bytes: bytes) -> Optional[Dict]:
    """
    Send a photo of a nutrition facts label to LM Studio and extract the
    printed values. The model only transcribes what's printed on the label
    (OCR/extraction) - it does not compute or estimate anything. Per-100g
    conversion from serving size happens in application code, not the model.

    Args:
        image_bytes: Raw bytes of the label photo

    Returns:
        A dict with keys: product_name, serving_size_g, calories_kcal,
        protein_g, carbs_g, fat_g. Any value the model couldn't read is
        None. Returns None if the call fails entirely (e.g. LM Studio
        unreachable) - callers should treat that as "nothing extracted",
        not an error, and fall back to a blank manual-entry form.
    """
    try:
        base64_image = base64.b64encode(image_bytes).decode('utf-8')

        prompt = """This is a photo of a food product's nutrition facts label (and packaging, if visible).

Read ONLY what is printed. Do not calculate, estimate, or guess any value you cannot clearly read.

Return a JSON object with exactly these fields:
- product_name: string or null (the product's name, from the packaging if visible)
- serving_size_g: number or null (the serving size in grams, if stated - convert only obvious units like "30g" or "1 bar (40g)"; if the serving size is not given in or convertible to grams, use null)
- calories_kcal: number or null (calories PER SERVING as printed, in kcal)
- protein_g: number or null (protein PER SERVING as printed, in grams)
- carbs_g: number or null (total carbohydrate PER SERVING as printed, in grams)
- fat_g: number or null (total fat PER SERVING as printed, in grams)

If the label states values "per 100g" instead of per serving, set serving_size_g to 100 and use those values directly.

Example output format:
{"product_name": "Sabra Classic Hummus", "serving_size_g": 30, "calories_kcal": 70, "protein_g": 2, "carbs_g": 4, "fat_g": 5}

Return ONLY the JSON object, no other text."""

        payload = {
            "model": LM_STUDIO_VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            "temperature": 0.1,
            "max_tokens": 512
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{LM_STUDIO_URL}/chat/completions",
                json=payload,
                timeout=30.0
            )

            if response.status_code != 200:
                print(f"LM Studio API error: {response.status_code} - {response.text}")
                return None

            result = response.json()

        if not result.get("choices") or not result["choices"][0].get("message", {}).get("content"):
            return None

        content = result["choices"][0]["message"]["content"].strip()

        import json

        # Clean up the response - extract JSON object if wrapped in markdown or other text
        json_start = content.find('{')
        json_end = content.rfind('}') + 1

        if json_start >= 0 and json_end > json_start:
            content = content[json_start:json_end]

        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            print(f"Failed to parse LM Studio response as JSON: {content}")
            return None

        if not isinstance(data, dict):
            return None

        def _num_or_none(value):
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        return {
            "product_name": str(data["product_name"]) if data.get("product_name") else None,
            "serving_size_g": _num_or_none(data.get("serving_size_g")),
            "calories_kcal": _num_or_none(data.get("calories_kcal")),
            "protein_g": _num_or_none(data.get("protein_g")),
            "carbs_g": _num_or_none(data.get("carbs_g")),
            "fat_g": _num_or_none(data.get("fat_g")),
        }

    except Exception as e:
        print(f"Error analyzing nutrition label: {e}")
        return None