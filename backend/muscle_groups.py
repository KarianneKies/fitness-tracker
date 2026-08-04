# muscle_groups.py — Exercise name -> primary muscle group lookup

"""
Maps exercise names to a primary muscle group, for the dashboard's muscle
silhouette panel. Mirrors the exercise list in frontend/exercises.js (same
groupings), so every exercise offered by the picker resolves to a group.

Functions:
- guess_muscle_group: Look up the muscle group for an exercise name
"""

from typing import Optional

MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Legs", "Biceps", "Triceps", "Core"]

_EXERCISE_MUSCLE_GROUP = {
    # Chest
    "Bench Press": "Chest",
    "Incline Bench Press": "Chest",
    "Decline Bench Press": "Chest",
    "Incline Dumbbell Press": "Chest",
    "Flat Dumbbell Press": "Chest",
    "Decline Dumbbell Press": "Chest",
    "Chest Fly (Machine)": "Chest",
    "Cable Crossover": "Chest",
    "Pec Deck": "Chest",
    "Push-Ups": "Chest",
    "Diamond Push-Ups": "Chest",
    "Wide Grip Push-Ups": "Chest",

    # Back
    "Pull-Up": "Back",
    "Chin-Up": "Back",
    "Lat Pulldown (Wide Grip)": "Back",
    "Lat Pulldown (Close Grip)": "Back",
    "Barbell Row": "Back",
    "Dumbbell Row": "Back",
    "Seated Cable Row": "Back",
    "Single-Arm Dumbbell Row": "Back",
    "Face Pull": "Back",
    "Deadlift": "Back",

    # Shoulders
    "Overhead Press (Barbell)": "Shoulders",
    "Overhead Press (Dumbbell)": "Shoulders",
    "Arnold Press": "Shoulders",
    "Lateral Raise": "Shoulders",
    "Front Raise": "Shoulders",
    "Rear Delt Fly": "Shoulders",
    "Shrug (Barbell)": "Shoulders",
    "Shrug (Dumbbell)": "Shoulders",
    "Upright Row": "Shoulders",

    # Legs
    "Squat (Barbell)": "Legs",
    "Front Squat": "Legs",
    "Goblet Squat": "Legs",
    "Leg Press": "Legs",
    "Leg Extension": "Legs",
    "Leg Curl (Seated)": "Legs",
    "Leg Curl (Lying)": "Legs",
    "Romanian Deadlift": "Legs",
    "Sumo Deadlift": "Legs",
    "Bulgarian Split Squat": "Legs",
    "Lunges": "Legs",
    "Walking Lunges": "Legs",

    # Biceps
    "Barbell Curl": "Biceps",
    "Dumbbell Curl (Alternating)": "Biceps",
    "Hammer Curl": "Biceps",
    "Preacher Curl": "Biceps",
    "Cable Curl": "Biceps",
    "Concentration Curl": "Biceps",

    # Triceps
    "Close-Grip Bench Press": "Triceps",
    "Triceps Pushdown (Rope)": "Triceps",
    "Triceps Pushdown (Bar)": "Triceps",
    "Overhead Triceps Extension": "Triceps",
    "Dumbbell Kickback": "Triceps",
    "Dips (Triceps focus)": "Triceps",

    # Core
    "Crunches": "Core",
    "Sit-Ups": "Core",
    "Plank": "Core",
    "Russian Twist": "Core",
    "Leg Raises": "Core",
    "Hanging Leg Raise": "Core",
    "Mountain Climbers": "Core",
    "Bicycle Crunches": "Core",
}

# Lowercased lookup for case-insensitive / minor-variation matching
_EXERCISE_MUSCLE_GROUP_LOWER = {name.lower(): group for name, group in _EXERCISE_MUSCLE_GROUP.items()}

# Fallback for names not in the curated list above (e.g. imported from another
# app with equipment suffixes like "Bench Press (Barbell)", or different
# phrasing like "Bicep Curl" vs. the picker's "Barbell Curl"). Checked in
# order, first substring match wins - multi-word/specific phrases are listed
# before the generic word they contain (e.g. "romanian deadlift" before
# "deadlift", "leg curl" before "curl") so the more specific group wins.
_KEYWORD_MUSCLE_GROUP = [
    ("face pull", "Back"),
    ("hip thrust", "Legs"),
    ("hip abductor", "Legs"),
    ("hip adductor", "Legs"),
    ("glute", "Legs"),
    ("wall sit", "Legs"),
    ("split squat", "Legs"),
    ("romanian deadlift", "Legs"),
    ("sumo deadlift", "Legs"),
    ("deadlift", "Back"),
    ("squat", "Legs"),
    ("leg press", "Legs"),
    ("leg extension", "Legs"),
    ("leg curl", "Legs"),
    ("leg raise", "Core"),
    ("lunge", "Legs"),
    ("calf", "Legs"),
    ("chest press", "Chest"),
    ("chest fly", "Chest"),
    ("bench press", "Chest"),
    ("pec deck", "Chest"),
    ("push-up", "Chest"),
    ("push up", "Chest"),
    ("crossover", "Chest"),
    ("lat pulldown", "Back"),
    ("pulldown", "Back"),
    ("pull-up", "Back"),
    ("pull up", "Back"),
    ("chin-up", "Back"),
    ("chin up", "Back"),
    ("row", "Back"),
    ("overhead press", "Shoulders"),
    ("shoulder press", "Shoulders"),
    ("arnold press", "Shoulders"),
    ("lateral raise", "Shoulders"),
    ("front raise", "Shoulders"),
    ("rear delt", "Shoulders"),
    ("reverse fly", "Shoulders"),
    ("shrug", "Shoulders"),
    ("upright row", "Shoulders"),
    ("bicep", "Biceps"),
    ("curl", "Biceps"),  # after leg curl is handled above
    ("triceps", "Triceps"),
    ("tricep", "Triceps"),
    ("close-grip bench", "Triceps"),
    ("close grip bench", "Triceps"),
    ("dip", "Triceps"),
    ("crunch", "Core"),
    ("sit-up", "Core"),
    ("sit up", "Core"),
    ("plank", "Core"),
    ("russian twist", "Core"),
    ("mountain climber", "Core"),
]


def guess_muscle_group(exercise_name: str) -> Optional[str]:
    """
    Look up the primary muscle group for an exercise name: exact match
    against the curated list first, then a keyword fallback for names in a
    different format (equipment suffixes, imported-app naming, etc.).

    Args:
        exercise_name: The exercise name as logged (e.g., "Bench Press (Barbell)")

    Returns:
        The muscle group name (e.g., "Chest"), or None if nothing matches
        (e.g. cardio like "Cycling", or a truly custom name).
    """
    if not exercise_name:
        return None

    exact = _EXERCISE_MUSCLE_GROUP.get(exercise_name)
    if exact:
        return exact

    lower = exercise_name.strip().lower()
    exact_lower = _EXERCISE_MUSCLE_GROUP_LOWER.get(lower)
    if exact_lower:
        return exact_lower

    for keyword, group in _KEYWORD_MUSCLE_GROUP:
        if keyword in lower:
            return group

    return None
