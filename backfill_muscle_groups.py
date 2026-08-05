# backfill_muscle_groups.py — One-off backfill for Exercise.muscle_group
#
# New exercises get muscle_group set automatically going forward (see
# backend/main.py's update_workout), but existing exercises logged before
# that field existed have muscle_group = NULL. This fills them in from the
# same name -> muscle group lookup, so the dashboard's muscle silhouette
# reflects historical workouts too. Safe to re-run - only touches NULL rows.
#
# Usage: python3 backfill_muscle_groups.py

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent
sys.path.insert(0, str(REPO_ROOT))

from backend.database import get_session
from backend.models import Exercise
from backend.muscle_groups import guess_muscle_group


def main():
    with get_session() as session:
        exercises = session.query(Exercise).filter(Exercise.muscle_group.is_(None)).all()

        tagged = 0
        unmatched_names = set()
        for exercise in exercises:
            group = guess_muscle_group(exercise.name)
            if group:
                exercise.muscle_group = group
                tagged += 1
            else:
                unmatched_names.add(exercise.name)

        session.commit()

    print(f"Tagged {tagged} of {len(exercises)} untagged exercises.")
    if unmatched_names:
        print(f"{len(unmatched_names)} exercise name(s) had no muscle group match (custom/free-typed names):")
        for name in sorted(unmatched_names):
            print(f"  - {name}")


if __name__ == "__main__":
    main()
