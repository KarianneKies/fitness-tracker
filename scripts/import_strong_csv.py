# import_strong_csv.py — One-off importer for a Strong app CSV export
#
# Reads strong_workouts.csv (not tracked in git - personal workout history)
# and loads it into app.db as Workout/Exercise/ExerciseSet rows, reusing the
# same models and migrations as the running app.
#
# Usage: python3 import_strong_csv.py

import csv
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # repo root (scripts/ is one level down)
CSV_PATH = REPO_ROOT / "strong_workouts.csv"

sys.path.insert(0, str(REPO_ROOT))

from backend.database import create_db_and_tables, get_session
from backend.models import Workout, Exercise, ExerciseSet


def parse_duration_seconds(duration_str):
    """Parse Strong's 'Xh Ym' / 'Xh' / 'Ym' duration format into seconds."""
    hours_match = re.search(r'(\d+)h', duration_str)
    minutes_match = re.search(r'(\d+)m', duration_str)
    hours = int(hours_match.group(1)) if hours_match else 0
    minutes = int(minutes_match.group(1)) if minutes_match else 0
    return hours * 3600 + minutes * 60


def to_float_or_none(value):
    try:
        f = float(value)
        return f if f != 0 else None
    except (TypeError, ValueError):
        return None


def group_into_sessions(rows):
    """Group CSV rows by workout session (Date is a unique session timestamp),
    then by exercise, preserving the file's row order."""
    sessions = {}
    for row in rows:
        date_str = row['Date']
        session = sessions.setdefault(date_str, {
            'name': row['Workout Name'].strip(),
            'duration': row['Duration'],
            'exercises': {}
        })
        exercise_name = row['Exercise Name'].strip()
        session['exercises'].setdefault(exercise_name, []).append(row)
    return sessions


def main():
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    sessions = group_into_sessions(rows)

    create_db_and_tables()

    workout_count = 0
    set_count = 0

    with get_session() as session:
        for date_str, sess in sessions.items():
            started_at = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
            duration_seconds = parse_duration_seconds(sess['duration'])
            finished_at = started_at + timedelta(seconds=duration_seconds)

            db_workout = Workout(
                started_at=started_at,
                finished_at=finished_at,
                duration_seconds=duration_seconds,
                name=sess['name'] or None,
            )
            session.add(db_workout)
            session.commit()
            session.refresh(db_workout)
            workout_count += 1

            for ex_order, (ex_name, ex_rows) in enumerate(sess['exercises'].items(), start=1):
                db_exercise = Exercise(
                    workout_id=db_workout.id,
                    name=ex_name,
                    order=ex_order,
                )
                session.add(db_exercise)
                session.commit()
                session.refresh(db_exercise)

                for set_order, row in enumerate(ex_rows, start=1):
                    set_label = row['Set Order'].strip()
                    note = 'Warmup' if set_label == 'W' else ('Dropset' if set_label == 'D' else None)
                    reps = to_float_or_none(row['Reps'])
                    seconds = to_float_or_none(row['Seconds'])

                    db_set = ExerciseSet(
                        exercise_id=db_exercise.id,
                        order=set_order,
                        reps=int(reps) if reps is not None else None,
                        weight_kg=to_float_or_none(row['Weight']),
                        hold_seconds=int(seconds) if seconds is not None else None,
                        to_failure=(set_label == 'F'),
                        note=note,
                    )
                    session.add(db_set)
                    set_count += 1
                session.commit()

    print(f"Imported {workout_count} workouts, {set_count} sets from {CSV_PATH.name}")


if __name__ == '__main__':
    main()
