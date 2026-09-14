"""End-to-end API tests against a TestClient with an empty temp DB.

These are smoke/contract tests: they exercise each router's happy path and
the error shapes the frontend depends on, not every branch.
"""

from datetime import date, timedelta


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------- workouts ----------
def test_workout_lifecycle(client):
    r = client.post("/workouts", json={"name": "Test Day"})
    assert r.status_code == 200
    wid = r.json()["id"]
    assert r.json()["name"] == "Test Day"
    assert r.json()["exercises"] == []

    r = client.patch(f"/workouts/{wid}", json={
        "exercises": [
            {"name": "Squat (Barbell)", "order": 0, "sets": [
                {"order": 0, "reps": 5, "weight_kg": 60.0, "to_failure": False},
                {"order": 1, "reps": 5, "weight_kg": 60.0, "to_failure": True},
            ]},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["exercises"]) == 1
    assert body["exercises"][0]["name"] == "Squat (Barbell)"
    assert body["exercises"][0]["muscle_group"]  # guessed, non-empty
    assert len(body["exercises"][0]["sets"]) == 2

    r = client.get(f"/workouts/{wid}")
    assert r.status_code == 200
    assert len(r.json()["exercises"][0]["sets"]) == 2

    # drop one set via a shorter sets list
    ex_id = body["exercises"][0]["id"]
    r = client.patch(f"/workouts/{wid}", json={
        "exercises": [{"id": ex_id, "name": "Squat (Barbell)", "order": 0, "sets": [
            {"order": 0, "reps": 8, "weight_kg": 55.0, "to_failure": False},
        ]}],
    })
    assert len(r.json()["exercises"][0]["sets"]) == 1

    assert client.delete(f"/workouts/{wid}").status_code == 200
    assert client.get(f"/workouts/{wid}").status_code == 404


def test_workout_404s(client):
    assert client.get("/workouts/999999").status_code == 404
    assert client.patch("/workouts/999999", json={"name": "x"}).status_code == 404
    assert client.delete("/workouts/999999").status_code == 404


# ---------- meals ----------
def _meal_payload(**over):
    base = {
        "name": "Lunch",
        "meal_date": "2026-09-02",
        "items": [
            {"name": "Chicken", "grams": 150, "calories": 165, "protein_g": 31, "carbs_g": 0, "fat_g": 3.6},
            {"name": "Rice", "grams": 100, "calories": 130, "protein_g": 2.7, "carbs_g": 28, "fat_g": 0.3},
        ],
    }
    base.update(over)
    return base


def test_meal_lifecycle_and_totals(client):
    r = client.post("/meals", json=_meal_payload())
    assert r.status_code == 200
    m = r.json()
    mid = m["id"]
    assert m["meal_date"] == "2026-09-02"
    assert round(m["total_calories"], 1) == 295.0
    assert round(m["total_protein_g"], 1) == 33.7

    r = client.patch(f"/meals/{mid}", json={"name": "Dinner", "items": [
        {"name": "Salmon", "grams": 120, "calories": 250, "protein_g": 25, "carbs_g": 0, "fat_g": 16},
    ]})
    assert r.status_code == 200
    assert r.json()["name"] == "Dinner"
    assert len(r.json()["items"]) == 1
    assert round(r.json()["total_calories"], 1) == 250.0

    # shows up in the by-day diary
    r = client.get("/nutrition/by-day")
    assert r.status_code == 200
    day = next(d for d in r.json() if d["date"] == "2026-09-02")
    assert round(day["daily_totals"]["calories"], 1) == 250.0

    assert client.delete(f"/meals/{mid}").status_code == 200
    assert client.get(f"/meals/{mid}").status_code == 404


def test_meal_requires_items(client):
    r = client.post("/meals", json={"name": "Empty", "items": []})
    assert r.status_code == 400
    assert "at least one" in r.json()["detail"]


def test_meal_bad_date(client):
    r = client.post("/meals", json=_meal_payload(meal_date="02-09-2026"))
    assert r.status_code == 400
    assert "YYYY-MM-DD" in r.json()["detail"]


# ---------- meal templates ----------
def test_meal_template_crud(client):
    r = client.post("/meal-templates", json={"name": "Usual Breakfast", "items": [
        {"name": "Oats", "grams": 80, "calories": 300, "protein_g": 11, "carbs_g": 50, "fat_g": 6},
    ]})
    assert r.status_code == 200
    tid = r.json()["id"]
    assert r.json()["total_calories"] == 300

    r = client.get("/meal-templates")
    assert any(t["id"] == tid for t in r.json())

    r = client.patch(f"/meal-templates/{tid}", json={"name": "Renamed", "items": [
        {"name": "Eggs", "grams": 100, "calories": 155, "protein_g": 13, "carbs_g": 1.1, "fat_g": 11},
    ]})
    assert r.json()["name"] == "Renamed"
    assert r.json()["items"][0]["name"] == "Eggs"

    assert client.delete(f"/meal-templates/{tid}").status_code == 200


# ---------- goal ----------
def test_goal_get_empty_then_set(client):
    r = client.get("/goal")
    assert r.status_code == 200  # all-null when unset

    r = client.put("/goal", json={
        "calorie_target": 1750, "protein_target_g": 180, "carb_target_g": 150,
        "fat_target_g": 60, "training_days_per_week": 5, "target_weight_kg": 65,
        "target_date": "2026-12-31",
    })
    assert r.status_code == 200
    assert r.json()["calorie_target"] == 1750
    assert r.json()["target_date"] == "2026-12-31"

    assert client.get("/goal").json()["calorie_target"] == 1750

    r = client.put("/goal", json={"target_date": "nope"})
    assert r.status_code == 400


# ---------- skipped days ----------
def test_skipped_days_idempotent_toggle(client):
    assert client.post("/skipped-days", json={"skip_date": "2026-08-27"}).status_code == 200
    # second POST is a no-op, still 200, same row
    r = client.post("/skipped-days", json={"skip_date": "2026-08-27"})
    assert r.status_code == 200
    assert r.json()["skip_date"] == "2026-08-27"

    assert any(d["skip_date"] == "2026-08-27" for d in client.get("/skipped-days").json())

    assert client.delete("/skipped-days/2026-08-27").status_code == 200
    # deleting again is also a no-op 200
    assert client.delete("/skipped-days/2026-08-27").status_code == 200
    assert not any(d["skip_date"] == "2026-08-27" for d in client.get("/skipped-days").json())

    assert client.post("/skipped-days", json={"skip_date": "not-a-date"}).status_code == 400


# ---------- exercises ----------
def test_exercise_history_endpoints(client):
    wid = client.post("/workouts", json={"name": "Hist"}).json()["id"]
    client.patch(f"/workouts/{wid}", json={"exercises": [
        {"name": "Bench Press (Barbell)", "order": 0, "sets": [
            {"order": 0, "reps": 5, "weight_kg": 45.0, "to_failure": False},
        ]},
    ]})
    client.patch(f"/workouts/{wid}", json={"finished_at": "2026-09-02T10:00:00"})

    names = client.get("/exercises/names").json()
    assert "Bench Press (Barbell)" in names

    logged = client.get("/exercises/logged").json()
    assert any(g["name"] == "Bench Press" for g in logged)  # equipment qualifier stripped

    prev = client.get("/exercises/previous", params={"name": "Bench Press (Barbell)"}).json()
    assert prev["sets"] and prev["sets"][0]["weight_kg"] == 45.0

    prog = client.get("/exercises/progress", params={"name": "Bench Press"}).json()
    assert prog and prog[-1]["weight_kg"] == 45.0

    client.delete(f"/workouts/{wid}")


def test_exercise_guide_match_and_miss(client):
    r = client.get("/exercises/guide", params={"name": "Romanian Deadlift (Barbell)"})
    assert r.status_code == 200
    g = r.json()
    assert g["matched"] is True
    assert g["steps"] and isinstance(g["steps"], list)
    assert g["gif_url"].startswith("https://cdn.jsdelivr.net/")
    assert g["equipment"]

    r = client.get("/exercises/guide", params={"name": "Totally Made Up Move 9000"})
    assert r.status_code == 200
    assert r.json()["matched"] is False


def test_exercise_history(client):
    # POST /workouts always stamps started_at = now; there's no way to
    # backdate it via the API (by design - see docs/PURGE-HISTORY.md-style
    # backdating goes through direct DB writes), so the expected date here
    # has to track the real "today", not a hardcoded one.
    wid = client.post("/workouts", json={"name": "H"}).json()["id"]
    client.patch(f"/workouts/{wid}", json={"exercises": [
        {"name": "Hip Thrust (Barbell)", "order": 0, "sets": [
            {"order": 0, "reps": 8, "weight_kg": 100.0, "to_failure": False},
            {"order": 1, "reps": 6, "weight_kg": 110.0, "to_failure": True},
        ]},
    ]})
    client.patch(f"/workouts/{wid}", json={"finished_at": f"{date.today().isoformat()}T10:00:00"})

    # base-name match: query without the "(Barbell)" qualifier
    r = client.get("/exercises/history", params={"name": "Hip Thrust"})
    assert r.status_code == 200
    hist = r.json()
    assert len(hist) == 1
    assert hist[0]["workout_id"] == wid
    assert hist[0]["date"] == date.today().isoformat()
    assert len(hist[0]["sets"]) == 2
    assert hist[0]["sets"][1]["weight_kg"] == 110.0 and hist[0]["sets"][1]["to_failure"] is True

    assert client.get("/exercises/history", params={"name": "Never Done"}).json() == []
    client.delete(f"/workouts/{wid}")


def test_custom_exercise_idempotent(client):
    a = client.post("/exercises/custom", json={"name": "Sissy Squat"})
    b = client.post("/exercises/custom", json={"name": "sissy squat"})
    assert a.status_code == b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    assert client.post("/exercises/custom", json={"name": "   "}).status_code == 400


def test_suggest_workout_split_validation(client):
    assert client.get("/suggest-workout", params={"split": "sideways"}).status_code == 400
    r = client.get("/suggest-workout", params={"split": "upper"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_knee_exercise_crud(client):
    r = client.post("/knee-exercises", json={"name": "Terminal Knee Extension"})
    assert r.status_code == 200
    kid = r.json()["id"]
    assert any(k["id"] == kid for k in client.get("/knee-exercises").json())
    assert client.delete(f"/knee-exercises/{kid}").status_code == 200
    assert client.delete(f"/knee-exercises/{kid}").status_code == 404


# ---------- foods ----------
def test_food_search_empty_and_blank(client):
    # temp DB has no USDA import, so any query returns []
    assert client.get("/foods/search", params={"q": "chicken"}).json() == []
    assert client.get("/foods/search", params={"q": "   "}).json() == []


def test_custom_food_and_serving(client):
    r = client.post("/foods/custom", json={
        "description": "Protein Bar", "calories_kcal": 380, "protein_g": 30,
        "carbs_g": 40, "fat_g": 12,
    })
    assert r.status_code == 200
    fid = r.json()["id"]
    assert r.json()["source"] == "custom"

    assert any(f["id"] == fid for f in client.get("/foods/search", params={"q": "protein"}).json())

    r = client.post("/foods/servings", json={
        "food_id": fid, "food_source": "custom", "label": "bar", "grams_per_unit": 60,
    })
    assert r.status_code == 200
    sid = r.json()["id"]
    assert client.get("/foods/servings", params={"food_id": fid, "food_source": "custom"}).json()[0]["id"] == sid

    assert client.post("/foods/servings", json={
        "food_id": fid, "food_source": "custom", "label": "x", "grams_per_unit": 0,
    }).status_code == 400

    assert client.delete(f"/foods/servings/{sid}").status_code == 200
    assert client.delete(f"/foods/custom/{fid}").status_code == 200


# ---------- checkins ----------
def test_checkin_crud_without_photo(client):
    r = client.post("/checkins", data={
        "checkin_date": "2026-08-21", "weight_kg": 75.4, "waist_cm": 78.0, "notes": "ok",
    })
    assert r.status_code == 200
    cid = r.json()["id"]
    assert r.json()["weight_kg"] == 75.4
    assert r.json()["photo_path"] is None

    r = client.patch(f"/checkins/{cid}", data={"weight_kg": 75.0})
    assert r.json()["weight_kg"] == 75.0
    assert r.json()["waist_cm"] == 78.0  # untouched

    assert any(c["id"] == cid for c in client.get("/checkins").json())
    assert client.delete(f"/checkins/{cid}").status_code == 200
    assert client.get(f"/checkins/{cid}").status_code == 404


# ---------- auto-flagging low-log days as skipped ----------
def test_auto_flag_low_log_days(client):
    low_day = (date.today() - timedelta(days=3)).isoformat()     # 500 kcal -> flagged
    ok_day = (date.today() - timedelta(days=2)).isoformat()      # 2000 kcal -> not flagged
    zero_day = (date.today() - timedelta(days=1)).isoformat()    # nothing logged -> flagged
    today = date.today().isoformat()                             # nothing logged, but is TODAY -> never touched

    client.post("/meals", json={"name": "d", "meal_date": low_day, "items": [
        {"name": "x", "grams": 1, "calories": 500, "protein_g": 1, "carbs_g": 1, "fat_g": 1},
    ]})
    client.post("/meals", json={"name": "d", "meal_date": ok_day, "items": [
        {"name": "x", "grams": 1, "calories": 2000, "protein_g": 1, "carbs_g": 1, "fat_g": 1},
    ]})
    # zero_day and today: no meals at all

    skipped = {d["skip_date"] for d in client.get("/skipped-days").json()}
    assert low_day in skipped
    assert zero_day in skipped
    assert ok_day not in skipped
    assert today not in skipped

    # idempotent: calling again doesn't duplicate or un-skip anything
    skipped2 = {d["skip_date"] for d in client.get("/skipped-days").json()}
    assert skipped2 == skipped

    # a manual un-skip sticks - auto-flagging never re-adds it
    client.delete(f"/skipped-days/{low_day}")
    skipped3 = {d["skip_date"] for d in client.get("/skipped-days").json()}
    assert low_day not in skipped3


# ---------- evaluation ----------
def test_daily_evaluation(client):
    client.put("/goal", json={"calorie_target": 2000, "protein_target_g": 150})
    client.post("/meals", json={
        "name": "All day", "meal_date": "2026-06-01", "items": [
            {"name": "Big", "grams": 500, "calories": 2100, "protein_g": 160, "carbs_g": 200, "fat_g": 70},
        ],
    })
    r = client.get("/evaluation/daily", params={"day": "2026-06-01"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "on_track"          # 2100 within 10% of 2000
    assert body["calories"]["actual"] == 2100.0
    assert body["calories"]["delta"] == 100.0
    assert body["protein_g"]["pct_of_target"] == 107

    # a day with nothing logged
    assert client.get("/evaluation/daily", params={"day": "2020-01-01"}).json()["status"] == "no_data"

    # a skipped day reads as skipped, not as a missed target
    client.post("/skipped-days", json={"skip_date": "2026-06-02"})
    r = client.get("/evaluation/daily", params={"day": "2026-06-02"})
    assert r.json()["status"] == "skipped" and r.json()["skipped"] is True

    assert client.get("/evaluation/daily", params={"day": "bad"}).status_code == 400


def test_weekly_evaluation_excludes_skipped(client):
    client.put("/goal", json={"calorie_target": 2000, "training_days_per_week": 3})
    # Mon 2026-06-08 .. Sun 2026-06-14
    for d, cal in [("2026-06-08", 2000), ("2026-06-09", 2000), ("2026-06-10", 6000)]:
        client.post("/meals", json={"name": "d", "meal_date": d, "items": [
            {"name": "x", "grams": 1, "calories": cal, "protein_g": 100, "carbs_g": 1, "fat_g": 1},
        ]})
    # 2026-06-10 was a blowout, but mark it skipped -> must drop out of the average
    client.post("/skipped-days", json={"skip_date": "2026-06-10"})

    r = client.get("/evaluation/weekly", params={"week_of": "2026-06-10"})
    assert r.status_code == 200
    body = r.json()
    assert body["week_start"] == "2026-06-08" and body["week_end"] == "2026-06-14"
    assert body["logged_days"] == ["2026-06-08", "2026-06-09"]
    # Other days later in the week may also be auto-flagged (no meals at
    # all, since this test's data is deliberately sparse) - the one thing
    # that must hold is that the manual skip is in there.
    assert "2026-06-10" in body["skipped_days"]
    assert body["avg_calories"]["actual"] == 2000.0     # 6000 excluded
    assert body["notable_days"] == []                    # the big day was skipped
    assert body["training"]["target"] == 3


# ---------- validation error shape the frontend parses ----------
def test_validation_error_is_list_of_loc_msg(client):
    r = client.post("/workouts", json={})  # WorkoutCreate has all-optional fields -> actually ok
    assert r.status_code == 200
    # a genuinely invalid body:
    r = client.post("/meals", json={"name": "x"})  # missing required "items"
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, list)
    assert "loc" in detail[0] and "msg" in detail[0]
