"""How-to-perform guide lookup for logged exercises.

Data is a stripped copy of https://github.com/hasaneyldrm/exercises-dataset
(vendored at backend/data/exercise_guide.json): English step-by-step
instructions, target muscles, equipment and a GIF path per exercise. The
GIF itself is loaded by the frontend from jsDelivr, not bundled.

Logged exercise names ("Bench Press (Barbell)", "Lying Leg Curl (Machine)")
don't match the dataset's names ("barbell bench press", "lever lying leg
curl") directly, so `find_guide` normalises and fuzzy-matches, with an
explicit alias table for the lifts that matter most.
"""

import json
import os
import re
from functools import lru_cache
from typing import Optional

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "exercise_guide.json")

# Equipment words that can appear in a logged name's "(...)" qualifier,
# mapped to the token the dataset uses.
_EQUIP_WORDS = {
    "barbell": "barbell", "dumbbell": "dumbbell", "cable": "cable",
    "machine": "lever", "smith": "smith", "kettlebell": "kettlebell",
    "band": "band", "bodyweight": "body", "assisted": "assisted",
}

# Logged name (normalised: lowercased, "(...)" stripped, punctuation collapsed)
# -> exact dataset name. Covers the exercises actually in this user's history
# where fuzzy matching is unreliable.
_ALIASES = {
    "bench press": "barbell bench press",
    "flat dumbbell press": "dumbbell bench press",
    "dumbbell press": "dumbbell bench press",
    "incline bench press": "barbell incline bench press",
    "romanian deadlift": "barbell romanian deadlift",
    "deadlift": "barbell deadlift",
    "squat": "barbell full squat",
    "lying leg curl": "lever lying leg curl",
    "seated leg curl": "lever seated leg curl",
    "leg extension": "lever leg extension",
    "leg extension 2 legs": "lever leg extension",
    "leg press": "smith leg press",
    "seated leg press": "smith leg press",
    "lat pulldown": "cable pulldown",
    "seated row": "cable seated row",
    "seated row cable": "cable seated row",
    "seated wide-grip row": "cable seated wide-grip row",
    "incline row": "dumbbell incline row",
    "lateral raise": "dumbbell lateral raise",
    "reverse fly": "dumbbell reverse fly",
    "chest fly": "dumbbell fly",
    "chest press": "lever chest press",
    "overhead press": "dumbbell standing overhead press",
    "seated overhead press": "barbell seated overhead press",
    "shoulder press": "lever shoulder press",
    "triceps extension": "dumbbell standing triceps extension",
    "triceps extension single arm": "dumbbell one arm triceps extension (on bench)",
    "triceps pushdown": "cable pushdown",
    "bicep curl": "dumbbell biceps curl",
    "biceps curl both arms": "cable curl",
    "incline curl": "dumbbell incline curl",
    "goblet squat": "kettlebell goblet squat",
    "bulgarian split squat": "dumbbell single leg split squat",
    "hip adductor": "lever seated hip adduction",
    "hip abductor": "lever seated hip abduction",
    "glute kickback": "cable standing hip extension",
    "glute bridge": "barbell glute bridge",
    "glute bridge machine": "barbell glute bridge",
    "hip thrust": "barbell glute bridge",  # same cue: heels down, ribs down, squeeze glutes
    "pull up": "assisted pull-up",
    "leg raises": "captains chair straight leg raise",
}

_STOP = {"the", "a", "with", "v", "2", "male", "female", "and", "to", "on"}


def _norm(name: str) -> str:
    """Lowercase, drop a trailing '(...)' qualifier, collapse punctuation."""
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name)
    name = name.replace("-", " ").replace("/", " ")
    name = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    name = re.sub(r"\s+", " ", name).strip()
    # local gym-chain suffixes that never appear in the dataset
    name = re.sub(r"\s+basic fit$", "", name)
    return name


def _tokens(name: str) -> set:
    return {t for t in _norm(name).split() if t not in _STOP}


def _equipment_hint(raw_name: str) -> Optional[str]:
    """The equipment token implied by a logged name's '(...)' qualifier or words."""
    lower = raw_name.lower()
    for word, token in _EQUIP_WORDS.items():
        if word in lower:
            return token
    return None


@lru_cache(maxsize=1)
def _load():
    with open(_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    exercises = data["exercises"]
    # Many dataset names collapse to the same normalised key ("barbell full
    # squat" and "barbell full squat (side pov)"). Keep the shortest raw
    # name for that key - it's the base movement, not a camera-angle variant.
    by_name: dict = {}
    for e in exercises:
        key = _norm(e["name"])
        if key not in by_name or len(e["name"]) < len(by_name[key]["name"]):
            by_name[key] = e
    index = [(_tokens(e["name"]), e) for e in exercises]
    return {
        "cdn": data["media_cdn"],
        "attribution": data["media_attribution"],
        "by_name": by_name,
        "index": index,
    }


def _score(query_tokens: set, cand_tokens: set, equip_hint: Optional[str], cand_name: str) -> float:
    if not query_tokens or not cand_tokens:
        return 0.0
    inter = len(query_tokens & cand_tokens)
    if inter == 0:
        return 0.0
    jaccard = inter / len(query_tokens | cand_tokens)
    bonus = 0.0
    if equip_hint and equip_hint in cand_tokens:
        bonus += 0.15
    # de-prioritise obvious variant clutter
    if "v." in cand_name or "(" in cand_name or "female" in cand_name:
        bonus -= 0.1
    return jaccard + bonus


def find_guide(logged_name: str) -> Optional[dict]:
    """
    Return a guide dict for a logged exercise name, or None if nothing
    matches well enough. GIF/image paths are returned as absolute CDN URLs.
    """
    store = _load()
    key = _norm(logged_name)

    match = None
    if key in _ALIASES:
        match = store["by_name"].get(_norm(_ALIASES[key]))
    if match is None:
        match = store["by_name"].get(key)
    if match is None:
        q = _tokens(logged_name)
        hint = _equipment_hint(logged_name)
        best, best_score = None, 0.0
        for cand_tokens, cand in store["index"]:
            s = _score(q, cand_tokens, hint, cand["name"])
            if s > best_score:
                best, best_score = cand, s
        # require a solid overlap so we never show a wrong movement
        if best_score >= 0.55:
            match = best

    if match is None:
        return None

    cdn = store["cdn"]
    return {
        "matched": True,
        "name": match["name"],
        "steps": match.get("steps") or [],
        "target": match.get("target"),
        "muscle_group": match.get("muscle_group"),
        "secondary_muscles": match.get("secondary_muscles") or [],
        "equipment": match.get("equipment"),
        "body_part": match.get("body_part"),
        "gif_url": cdn + match["gif"] if match.get("gif") else None,
        "image_url": cdn + match["image"] if match.get("image") else None,
        "attribution": store["attribution"],
    }
