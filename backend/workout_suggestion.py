# workout_suggestion.py — Generate a suggested next workout

"""
Generates a suggested next workout (roughly 4-6 exercises) for the "Start
Workout" choice screen's "Recommended Workout" option. This is a suggestion
only, presented for the user to review and choose to start or discard - it
never starts a workout on its own and makes no medical claims about any
exercise (including the knee-strengthening list, which is just a category
the user defined for themselves from physio guidance).

Priority order:
0. Upper/lower split - every proposed workout is either all upper-body or
   all lower-body exercises, never a mix. The user picks which; if they
   don't, it's auto-decided by whichever side is more neglected (see
   _choose_split), biased toward lower body to reflect glute priority.
1. Neglected muscles - within the chosen split, muscle groups that have
   gone the longest since they were last trained (all-time, not just a
   rolling window - see _days_since_trained) are favored.
2. Glute priority - on a lower-body day, a glute-focused exercise is
   always included when one is eligible (stated user goal).
3. Knee strength - on a lower-body day, at least one exercise from the
   user's knee-strengthening list is always included. Unlike every other
   pick, knee-list exercises are eligible regardless of when (or whether)
   they were last performed - see POOL_LOOKBACK_DAYS.
4. Balanced coverage - remaining slots are filled across different muscle
   groups (upper day) or across the leg pool (lower day) rather than
   repeating one exercise.

Every non-knee-list suggestion is drawn only from exercises the user has
actually logged in the last POOL_LOOKBACK_DAYS days - never from the full
hardcoded catalog, so a suggestion never proposes something never done or
long abandoned.

Functions:
- seed_default_knee_exercises: Populate the knee-strengthening list on first run
- suggest_workout: Build one proposed workout as a list of {name, muscle_group, reason}
"""

import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlmodel import Session

from .models import Exercise, KneeExercise, Workout
from .muscle_groups import MUSCLE_GROUPS, guess_muscle_group

# Seeded once on first run (see seed_default_knee_exercises); the user can
# add/remove entries afterward via the /knee-exercises endpoints.
DEFAULT_KNEE_EXERCISES = [
    "Smith Machine Squat",
    "Leg Extension",
    "Lying Leg Curl",
    "Romanian Deadlift (RDL)",
    "Bulgarian Split Squat",
]

# Glute-focused picks, drawn only from exercises already known to the app
# (the curated list in muscle_groups.py / frontend/exercises.js). Glutes
# aren't their own entry in MUSCLE_GROUPS (they fall under "Legs"), so this
# is a hand-picked subset used only to weight glute work higher - not a
# separate muscle-group category. Unlike the knee list, these still have to
# have actually been performed in the last POOL_LOOKBACK_DAYS days.
GLUTE_EXERCISE_NAMES = [
    "Squat (Barbell)",
    "Front Squat",
    "Goblet Squat",
    "Romanian Deadlift",
    "Sumo Deadlift",
    "Bulgarian Split Squat",
    "Walking Lunges",
    "Lunges",
]

MIN_EXERCISES = 4
MAX_EXERCISES = 6

# Only exercises actually logged within this window are eligible for
# suggestion (except the knee-strengthening list, which is always eligible -
# see _candidate_pool and suggest_workout).
POOL_LOOKBACK_DAYS = 90

# Sentinel "days since trained" used only for numeric comparisons (ordering,
# split-decision averaging) when a muscle group has never been trained.
# Kept finite (rather than infinity) so one never-trained group in a split
# doesn't blow up that side's average to infinity and swamp the others -
# it just reads as very neglected. _neglect_reason phrases this case as
# "not trained yet" rather than a literal day count.
NEVER_TRAINED_SCORE = 9999

# A proposed workout is always all-upper or all-lower, never mixed. "Legs"
# is the only lower-body entry in MUSCLE_GROUPS; everything else is upper.
# Core doesn't cleanly belong to either, so it's grouped with upper (most
# upper/lower routines fold core into whichever day, and it can't sensibly
# join a leg day).
UPPER_BODY_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Core"]
LOWER_BODY_GROUPS = ["Legs"]

# Multiplies Legs' neglect score before comparing it to upper body's average
# in auto-decide mode, so a lower-body day wins ties and near-ties more
# often - reflecting glute priority without hard-forcing every suggestion
# to be leg day.
LOWER_BODY_BIAS = 1.3


def seed_default_knee_exercises(session: Session) -> None:
    """
    Populate the knee-strengthening list with the physio-given defaults the
    first time the app runs. No-op if the table already has any entries
    (including if the user has since removed all of them - that's a
    deliberate empty list, not a fresh install).
    """
    existing = session.query(KneeExercise).first()
    if existing is not None:
        return
    for name in DEFAULT_KNEE_EXERCISES:
        session.add(KneeExercise(name=name))
    session.commit()


def _last_trained_at(session: Session) -> Dict[str, datetime]:
    """Most recent workout start time that included each muscle group, all-time."""
    last_trained = {}
    rows = (
        session.query(Exercise.muscle_group, Workout.started_at)
        .join(Workout, Exercise.workout_id == Workout.id)
        .all()
    )
    for group, started_at in rows:
        if group not in MUSCLE_GROUPS or started_at is None:
            continue
        if group not in last_trained or started_at > last_trained[group]:
            last_trained[group] = started_at
    return last_trained


def _days_since_trained(group: str, last_trained: Dict[str, datetime], now: datetime) -> Optional[int]:
    """
    Whole calendar days between the last time a muscle group was trained and
    now, or None if it's never been trained. Computed as a calendar-date
    difference (now.date() - last_trained.date()), not elapsed-hours //
    24 - the latter undercounts by one whenever the last session was later
    in the day than the current time (e.g. trained Monday 5pm, checked
    Wednesday 9am is 2 calendar days, but only 1 day 16 hours of elapsed
    time). Both timestamps are naive UTC (how Workout.started_at is always
    stored), so this is internally consistent even without a stored user
    timezone.
    """
    last_dt = last_trained.get(group)
    if last_dt is None:
        return None
    return max((now.date() - last_dt.date()).days, 0)


def _neglect_score(group: str, last_trained: Dict[str, datetime], now: datetime) -> int:
    """Days since trained, for ordering/averaging - never-trained maps to NEVER_TRAINED_SCORE."""
    days = _days_since_trained(group, last_trained, now)
    return NEVER_TRAINED_SCORE if days is None else days


def _neglect_reason(group: str, last_trained: Dict[str, datetime], now: datetime) -> str:
    label = group.lower()
    days = _days_since_trained(group, last_trained, now)
    if days is None:
        return f"{label} — not trained yet"
    if days == 0:
        return f"{label} — least recently trained today"
    return f"{label} — not trained in {days} day{'s' if days != 1 else ''}"


def _choose_split(last_trained: Dict[str, datetime], now: datetime, rng: random.Random) -> List[str]:
    """
    Decide whether this suggestion is an upper-body or lower-body workout,
    based on which side has gone longer since it was last trained. Compares
    the average neglect score per muscle group on each side (so upper's 6
    groups vs. lower's 1 aren't compared unfairly), with lower body's score
    multiplied by LOWER_BODY_BIAS to reflect glute priority.

    Returns:
        Either UPPER_BODY_GROUPS or LOWER_BODY_GROUPS
    """
    upper_avg = sum(_neglect_score(g, last_trained, now) for g in UPPER_BODY_GROUPS) / len(UPPER_BODY_GROUPS)
    lower_score = _neglect_score("Legs", last_trained, now) * LOWER_BODY_BIAS
    if lower_score > upper_avg:
        return LOWER_BODY_GROUPS
    if upper_avg > lower_score:
        return UPPER_BODY_GROUPS
    return rng.choice([UPPER_BODY_GROUPS, LOWER_BODY_GROUPS])


def _candidate_pool(session: Session, cutoff: datetime) -> Dict[str, str]:
    """
    Exercise name -> muscle group, restricted to exercises actually logged
    in a workout started on/after cutoff - "exercises I actually do right
    now", not the full hardcoded catalog. The knee-strengthening list is
    exempt from this window (added separately in suggest_workout).
    """
    pool: Dict[str, str] = {}
    rows = (
        session.query(Exercise.name)
        .join(Workout, Exercise.workout_id == Workout.id)
        .filter(Workout.started_at >= cutoff)
        .distinct()
        .all()
    )
    for (name,) in rows:
        group = guess_muscle_group(name)
        if group:
            pool[name] = group
    return pool


def suggest_workout(
    session: Session,
    rng: Optional[random.Random] = None,
    split: Optional[str] = None,
) -> List[dict]:
    """
    Build one proposed workout.

    Args:
        session: Active DB session
        rng: Optional random.Random for deterministic tests; a fresh one is
            used otherwise so repeated calls (e.g. "Shuffle") vary.
        split: "upper" or "lower" to let the user pick the split themselves;
            None to auto-decide from recent neglect (see _choose_split).

    Returns:
        List of {"name": str, "muscle_group": str, "reason": str}, roughly
        4-6 items, all from the same upper/lower split and all drawn from
        exercises performed in the last POOL_LOOKBACK_DAYS days (except
        knee-list picks, which are exempt from that window). Lower-body
        suggestions always include a knee-strengthening exercise, and a
        glute-focused exercise when one is eligible.

    Raises:
        ValueError: if split is given and isn't "upper" or "lower"
    """
    rng = rng or random.Random()
    now = datetime.utcnow()
    pool_cutoff = now - timedelta(days=POOL_LOOKBACK_DAYS)

    last_trained = _last_trained_at(session)
    pool = _candidate_pool(session, pool_cutoff)

    by_group: Dict[str, List[str]] = {g: [] for g in MUSCLE_GROUPS}
    for name, group in pool.items():
        if group in by_group:
            by_group[group].append(name)
    for names in by_group.values():
        rng.shuffle(names)

    chosen: List[dict] = []
    chosen_lower = set()

    def add(name: str, group: str, reason: str) -> bool:
        key = name.lower()
        if key in chosen_lower:
            return False
        chosen.append({"name": name, "muscle_group": group, "reason": reason})
        chosen_lower.add(key)
        return True

    if split is None:
        split_groups = _choose_split(last_trained, now, rng)
    elif split.lower() == "lower":
        split_groups = LOWER_BODY_GROUPS
    elif split.lower() == "upper":
        split_groups = UPPER_BODY_GROUPS
    else:
        raise ValueError(f"split must be 'upper' or 'lower', got {split!r}")

    if split_groups is LOWER_BODY_GROUPS:
        # 1. Knee strength - always at least one, picked from the user's
        # list. Exempt from the POOL_LOOKBACK_DAYS window: these are
        # physio-assigned, so they stay eligible even if not done recently.
        knee_names = [k.name for k in session.query(KneeExercise).all()]
        rng.shuffle(knee_names)
        for name in knee_names:
            group = pool.get(name) or guess_muscle_group(name) or "Legs"
            if add(name, group, "knee strength"):
                break

        # 2. Glute priority - one, if a glute-list exercise was actually
        # performed in the last POOL_LOOKBACK_DAYS days (not exempt from
        # the window, unlike the knee list).
        glute_candidates = [n for n in GLUTE_EXERCISE_NAMES if n in pool]
        rng.shuffle(glute_candidates)
        for name in glute_candidates:
            if name.lower() in chosen_lower:
                continue
            if add(name, pool[name], "glutes — goal priority"):
                break

        # 3. Fill remaining slots from the rest of the leg pool.
        leg_reason = _neglect_reason("Legs", last_trained, now)
        for i, name in enumerate(by_group.get("Legs", [])):
            if len(chosen) >= MAX_EXERCISES:
                break
            add(name, "Legs", leg_reason if i == 0 else "legs — balanced coverage")
    else:
        # Fill slots across upper-body groups, most-neglected first - one
        # per group covers the full 4-6 range since there are 6 upper groups.
        order = sorted(
            split_groups,
            key=lambda g: (_neglect_score(g, last_trained, now), rng.random()),
            reverse=True,
        )
        for group in order:
            if len(chosen) >= MAX_EXERCISES:
                break
            candidates = [n for n in by_group.get(group, []) if n.lower() not in chosen_lower]
            if not candidates:
                continue
            add(candidates[0], group, _neglect_reason(group, last_trained, now))

        # Fallback: if the pool was too thin to reach the minimum in one pass
        # (e.g. few exercises logged in the last 3 months), cycle the group
        # order again.
        idx = 0
        while len(chosen) < MIN_EXERCISES and idx < len(order) * 3:
            group = order[idx % len(order)]
            candidates = [n for n in by_group.get(group, []) if n.lower() not in chosen_lower]
            if candidates:
                add(candidates[0], group, _neglect_reason(group, last_trained, now))
            idx += 1

    return chosen[:MAX_EXERCISES]
