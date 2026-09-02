# evaluation.py — Daily / weekly nutrition + training evaluation

"""
Pure analysis functions: given a session and a date (or week), sum the
logged data and compare it to the active goal. No HTTP concerns here -
backend/routers/evaluation.py wraps these.

A "skipped" day (backend.models.DailySkippedDay) is treated as no data: it
never counts toward an average and never counts as a missed target.
"""

from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func

from .models import (
    Meal,
    FoodItem,
    Workout,
    Goal,
    WeeklyCheckin,
    DailySkippedDay,
)

# How far a day's calories can sit from target before it stops being "on track".
_ON_TRACK_BAND = 0.10   # +/- 10% around the calorie target
_UNDER_BAND = 0.15      # more than 15% under target -> "under"
_BIG_SURPLUS = 1.25     # >= 125% of target -> flagged as a notable day


def _active_goal(session) -> Optional[Goal]:
    return session.query(Goal).filter(Goal.active == True).order_by(  # noqa: E712
        Goal.created_at.desc()
    ).first()


def _skipped_dates(session, start: date, end: date) -> set:
    rows = session.query(DailySkippedDay.skip_date).filter(
        DailySkippedDay.skip_date >= start,
        DailySkippedDay.skip_date <= end,
    ).all()
    return {r[0] for r in rows}


def _day_macros(session, day: date) -> dict:
    """Sum calories/protein/carbs/fat across every food item logged for `day`."""
    row = (
        session.query(
            func.coalesce(func.sum(FoodItem.calories), 0.0),
            func.coalesce(func.sum(FoodItem.protein_g), 0.0),
            func.coalesce(func.sum(FoodItem.carbs_g), 0.0),
            func.coalesce(func.sum(FoodItem.fat_g), 0.0),
            func.count(func.distinct(Meal.id)),
        )
        .select_from(Meal)
        .join(FoodItem, FoodItem.meal_id == Meal.id)
        .filter(Meal.meal_date == day)
        .first()
    )
    calories, protein, carbs, fat, meal_count = row
    return {
        "calories": round(calories, 1),
        "protein_g": round(protein, 1),
        "carbs_g": round(carbs, 1),
        "fat_g": round(fat, 1),
        "meal_count": int(meal_count),
    }


def _workouts_on(session, day: date) -> dict:
    start = _dt(day)
    end = _dt(day + timedelta(days=1))
    rows = session.query(Workout).filter(
        Workout.started_at >= start, Workout.started_at < end
    ).all()
    return {
        "count": len(rows),
        "total_minutes": round(sum((w.duration_seconds or 0) for w in rows) / 60),
        "names": [w.name for w in rows if w.name],
    }


def _dt(d: date):
    from datetime import datetime
    return datetime(d.year, d.month, d.day)


def _target_line(actual: float, target: Optional[float]) -> dict:
    """A {actual, target, delta, pct} block; pct/delta are None when no target."""
    out = {"actual": round(actual, 1), "target": target, "delta": None, "pct_of_target": None}
    if target:
        out["delta"] = round(actual - target, 1)
        out["pct_of_target"] = round(actual / target * 100)
    return out


def _calorie_status(actual: float, target: Optional[float]) -> str:
    if not target:
        return "no_target"
    ratio = actual / target
    if ratio > 1 + _ON_TRACK_BAND:
        return "over"
    if ratio < 1 - _UNDER_BAND:
        return "under"
    return "on_track"


def evaluate_day(session, day: Optional[date] = None) -> dict:
    """
    One day's nutrition + training vs the active goal.

    status is one of: "skipped", "no_data", "on_track", "over", "under",
    "no_target".
    """
    day = day or date.today()
    goal = _active_goal(session)

    if day in _skipped_dates(session, day, day):
        return {"date": day.isoformat(), "status": "skipped", "skipped": True}

    macros = _day_macros(session, day)
    workouts = _workouts_on(session, day)

    if macros["meal_count"] == 0:
        status = "no_data"
    else:
        status = _calorie_status(
            macros["calories"], goal.calorie_target if goal else None
        )

    return {
        "date": day.isoformat(),
        "skipped": False,
        "status": status,
        "meal_count": macros["meal_count"],
        "calories": _target_line(macros["calories"], goal.calorie_target if goal else None),
        "protein_g": _target_line(macros["protein_g"], goal.protein_target_g if goal else None),
        "carbs_g": _target_line(macros["carbs_g"], goal.carb_target_g if goal else None),
        "fat_g": _target_line(macros["fat_g"], goal.fat_target_g if goal else None),
        "workouts": workouts,
    }


def _monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _nearest_checkin_weight(session, on_or_before: date):
    row = (
        session.query(WeeklyCheckin)
        .filter(WeeklyCheckin.checkin_date <= on_or_before, WeeklyCheckin.weight_kg.isnot(None))
        .order_by(WeeklyCheckin.checkin_date.desc())
        .first()
    )
    return (row.checkin_date, row.weight_kg) if row else (None, None)


def evaluate_week(session, week_start: Optional[date] = None) -> dict:
    """
    A calendar week (Mon-Sun) summarised against the goal: average daily
    calories and protein over the days that were actually logged and not
    skipped, training days vs target, and the weight trend from check-ins.
    """
    week_start = _monday_of(week_start or date.today())
    week_end = week_start + timedelta(days=6)
    goal = _active_goal(session)
    skipped = _skipped_dates(session, week_start, week_end)

    logged_days = []          # dates with >=1 meal, not skipped
    daily_calories = []
    daily_protein = []
    notable_days = []         # big-surplus days
    for i in range(7):
        day = week_start + timedelta(days=i)
        if day in skipped:
            continue
        m = _day_macros(session, day)
        if m["meal_count"] == 0:
            continue
        logged_days.append(day.isoformat())
        daily_calories.append(m["calories"])
        daily_protein.append(m["protein_g"])
        if goal and goal.calorie_target and m["calories"] >= goal.calorie_target * _BIG_SURPLUS:
            notable_days.append({"date": day.isoformat(), "calories": m["calories"]})

    n = len(daily_calories)
    avg_cal = sum(daily_calories) / n if n else 0.0
    avg_pro = sum(daily_protein) / n if n else 0.0

    # training days: distinct calendar dates with a workout in the week
    wk_rows = session.query(Workout.started_at).filter(
        Workout.started_at >= _dt(week_start),
        Workout.started_at < _dt(week_end + timedelta(days=1)),
    ).all()
    training_days = len({d[0].date() for d in wk_rows})

    # weight trend: this week's latest check-in vs one ~two weeks earlier
    cur_date, cur_w = _nearest_checkin_weight(session, week_end)
    prev_w = None
    if cur_date:
        _, prev_w = _nearest_checkin_weight(session, cur_date - timedelta(days=10))
    weight_change = round(cur_w - prev_w, 1) if (cur_w is not None and prev_w is not None) else None

    cal_status = _calorie_status(avg_cal, goal.calorie_target if goal else None) if n else "no_data"
    train_target = goal.training_days_per_week if goal else None
    train_status = (
        "no_target" if not train_target
        else "on_track" if training_days >= train_target
        else "under"
    )

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "logged_days": logged_days,
        "skipped_days": sorted(d.isoformat() for d in skipped),
        "avg_calories": _target_line(avg_cal, goal.calorie_target if goal else None),
        "avg_protein_g": _target_line(avg_pro, goal.protein_target_g if goal else None),
        "calorie_status": cal_status,
        "training": {
            "days": training_days,
            "target": train_target,
            "status": train_status,
        },
        "weight": {
            "latest_kg": cur_w,
            "latest_date": cur_date.isoformat() if cur_date else None,
            "change_kg": weight_change,
        },
        "notable_days": notable_days,
    }
