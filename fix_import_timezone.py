# fix_import_timezone.py — One-off fix for import_strong_csv.py's timezone bug
#
# import_strong_csv.py parsed the Strong app's exported Date column (local
# wall-clock time - Strong's own "Early Morning Workout" / "Evening Workout"
# auto-naming only makes sense read as local time) and stored it directly as
# Workout.started_at - the same column every other timestamp in the app
# (live-logged workouts via datetime.utcnow(), and any "now" comparison)
# treats as naive UTC. That mislabels every imported workout's timestamp by
# the local UTC offset (CET/CEST), which can shift "days since trained"
# calculations by a day and makes imported-vs-live comparisons inconsistent.
#
# This reinterprets each imported session's date as local time (in the Mac's
# configured zone) and rewrites started_at/finished_at to the correct UTC
# equivalent, so every timestamp in the app is genuinely, consistently UTC.
#
# Safe to re-run: matches rows by the exact (mislabeled) timestamp the
# original import produced, so once a row's been corrected it no longer
# matches and is left alone.
#
# Usage: python3 fix_import_timezone.py

import csv
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).parent
CSV_PATH = REPO_ROOT / "strong_workouts.csv"

sys.path.insert(0, str(REPO_ROOT))

from backend.database import get_session
from backend.models import Workout

# The Mac's configured local timezone (see /etc/localtime) - Strong's export
# and its time-of-day auto-naming are in this zone, not UTC.
LOCAL_ZONE = ZoneInfo("Europe/Oslo")


def session_dates(rows):
    """The distinct session Date strings from the CSV - one per imported Workout."""
    return sorted({row["Date"] for row in rows})


def main():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    dates = session_dates(rows)

    fixed = 0
    skipped = 0

    with get_session() as session:
        for date_str in dates:
            mislabeled = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")

            workout = session.query(Workout).filter(Workout.started_at == mislabeled).first()
            if workout is None:
                skipped += 1
                continue

            correct_utc = mislabeled.replace(tzinfo=LOCAL_ZONE).astimezone(timezone.utc).replace(tzinfo=None)
            delta = correct_utc - mislabeled

            workout.started_at = correct_utc
            if workout.finished_at is not None:
                workout.finished_at = workout.finished_at + delta
            fixed += 1

        session.commit()

    print(f"Fixed {fixed} of {len(dates)} imported workout(s).")
    print(f"Skipped {skipped} (already corrected on a prior run, or no longer present).")


if __name__ == "__main__":
    main()
