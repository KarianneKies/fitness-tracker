# vendor_exercise_guide.py — rebuild backend/data/exercise_guide.json
#
# Downloads the full exercises dataset from
#   https://github.com/hasaneyldrm/exercises-dataset
# and strips it to English-only + the fields the app uses (name, steps,
# muscles, equipment, media paths). The ~17 MB source becomes ~1 MB.
#
# The GIFs themselves are NOT vendored - the frontend loads them from
# jsDelivr (media_cdn below) on demand.
#
# Usage:  python3 scripts/vendor_exercise_guide.py

import json
import urllib.request
from pathlib import Path

SRC = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json"
OUT = Path(__file__).resolve().parent.parent / "backend" / "data" / "exercise_guide.json"


def main() -> None:
    with urllib.request.urlopen(SRC) as resp:
        records = json.load(resp)

    out = []
    for r in records:
        steps = (r.get("instruction_steps") or {}).get("en") or []
        if not steps:
            para = (r.get("instructions") or {}).get("en") or ""
            steps = [s.strip() for s in para.split(". ") if s.strip()]
        out.append({
            "id": r["id"],
            "name": r["name"],
            "target": r.get("target"),
            "muscle_group": r.get("muscle_group"),
            "secondary_muscles": r.get("secondary_muscles") or [],
            "equipment": r.get("equipment"),
            "body_part": r.get("body_part"),
            "steps": steps,
            "gif": r.get("gif_url"),
            "image": r.get("image"),
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "https://github.com/hasaneyldrm/exercises-dataset",
        "media_cdn": "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/",
        "media_attribution": "© Gym Visual — https://gymvisual.com/",
        "exercises": out,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(out)} exercises)")


if __name__ == "__main__":
    main()
