# vision.py — Identify foods in photos using LM Studio (OpenAI-compatible)

"""
Vision module for analyzing food photos and identifying food items using a local
LM Studio server with an OpenAI-compatible API.

Functions:
- analyze_food_photo: Send a photo to LM Studio and get food identification
"""

import base64
import httpx
from typing import Dict, List, Optional

from .config import LM_STUDIO_URL


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
            "model": "local",
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