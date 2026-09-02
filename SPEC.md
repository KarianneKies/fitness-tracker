# SPEC.md — Local Fitness & Nutrition Tracker

> This document is both the project plan and the primary context file for the
> coding agent (Cline). Treat every decision here as **already made**. Do not
> re-architect, do not add external services, do not introduce dependencies that
> are not listed. When something is ambiguous, prefer the simplest option that
> keeps everything local. Build in small, focused steps.

> **Implementation status (2026-09):** the manual workout log, food search +
> meal logging, check-ins, goals, the "suggest a workout" flow and skip-day
> tracking are built. The photo->macro (`nutrition.py`) and barcode->macro
> (`barcode.py`) pipelines described below are **not built** - those modules
> were removed rather than kept as empty stubs. `evaluation.py` is being
> built now. Sections describing the unbuilt pipelines are kept as the
> design to follow if/when they're picked up.

---

## 1. What this is

A personal fitness and nutrition tracker that runs **entirely on the user's own
hardware**. The user captures data on their **phone**; all processing and storage
happens on their **Mac**. Nothing is sent to any external service, cloud, or
third-party database.

What the user wants to do:

1. **Log exercises** — a simple manual log of workouts.
2. **Log food by photo** — take a photo of a meal; the app identifies the food,
   estimates portions, looks up macros, and lets the user correct the result.
   After correcting, the user may **optionally scan a product barcode** for any
   packaged item to replace the estimate with exact label macros.
3. **Weekly check-in** — once a week, take a progress photo of themselves and record
   body measurements (weight + circumferences), stored locally, to track physical
   change over time.
4. **Set a goal** — daily nutrition targets (calories + macros) and, optionally, a
   longer-term body goal (e.g. target weight). Exercise targets optional.
5. **End-of-day evaluation** — when the user finishes their day, the app sums the
   day's food and exercise, compares it to the goal, and shows a short, constructive
   written evaluation of how the day went. Stored so the user can look back.

The food feature therefore has **two complementary sources**: the photo path (for
fresh / home-cooked food, which has no barcode) and the barcode path (for packaged
products, which carries exact per-100g macros from the label).

## 2. Core principles (non-negotiable)

- **Local-only.** No cloud, no external APIs, no external database. If a feature
  would require the internet at runtime, it is out of scope.
- **The phone captures; the Mac computes and stores.** The phone runs no models.
- **The vision model never invents macro numbers.** It only *identifies food and
  estimates portion size*. Actual macros always come from the local nutrition
  database. Portions are always user-correctable before a meal is saved.
- **Small, focused code.** Prefer clarity over cleverness. This runs on a local
  LLM agent, so keep each module and each change tightly scoped.

## 3. Architecture

```
  [ Phone (PWA on home screen) ]                       [ Mac ]
        camera + UI                                  FastAPI backend
             |                                       SQLite database
             |  home:  local wifi                    /data/photos folder
             |  away:  Tailscale private tunnel      LM Studio (vision model)
             +-------- (encrypted, direct) ------>   USDA + Open Food Facts DBs
```

- The Mac serves both the **API** and the **PWA static files** from one FastAPI app.
- **At home:** the phone reaches the Mac over the local wifi.
- **Away from home:** the phone reaches the Mac over **Tailscale**, a private
  encrypted mesh (WireGuard) between only the user's own devices. No router ports
  are opened; no traffic passes through a third-party database. This preserves the
  local-only principle — data goes phone→Mac encrypted, never to a cloud.
- Use the Mac's **Tailscale hostname** as the app URL so the *same* link works both
  at home and away (no switching addresses).
- The Mac must be **awake and running** for the phone to reach it from anywhere.
  Configure it not to sleep. (The user can always take a photo offline and process
  it later when the Mac is reachable.)
- **HTTPS:** a PWA needs a secure context for install + camera when not on
  `localhost`. Use Tailscale's HTTPS certificate feature to serve the app over a
  valid HTTPS hostname on the tailnet. This is required for the "away" case.

## 4. Tech stack (locked)

| Layer        | Choice                                                        |
|--------------|---------------------------------------------------------------|
| Backend      | Python 3.11+, **FastAPI**, served with **uvicorn**            |
| Data models  | **SQLModel** (Pydantic + SQLAlchemy, typed models)           |
| Database     | **SQLite** (single file, `app.db`)                            |
| Photo storage| Local filesystem: `data/photos/` (git-ignored)               |
| Frontend     | **Vanilla PWA** — plain HTML/CSS/JS, no framework, no build step |
| Vision model | **LM Studio**, OpenAI-compatible endpoint at `http://localhost:3142/v1` |
| Nutrition DB | **USDA FoodData Central**, imported locally into SQLite       |
| Product DB   | **Open Food Facts** (Parquet dump), imported locally into SQLite, keyed by barcode |
| Barcode scan | Client-side JS barcode reader in the PWA (reads EAN-13 / UPC from the camera) |
| Remote access| **Tailscale** private mesh (WireGuard) for away-from-home use; HTTPS via Tailscale cert |

Do **not** add React, a bundler, an ORM other than SQLModel, or any cloud SDK.
The barcode is read **on the phone**; the lookup runs **against the local Open Food
Facts copy** — never against the Open Food Facts online API at runtime.

## 5. Data model

**Exercise**
- `id`, `timestamp`
- `name` (e.g. "Bench press")
- `sets`, `reps`, `weight_kg` (nullable — for strength work)
- `duration_min` (nullable — for cardio)
- `notes` (nullable)

**Meal**
- `id`, `timestamp`
- `photo_path`
- `items` — list of `FoodItem` (relationship)
- `total_calories`, `total_protein_g`, `total_carbs_g`, `total_fat_g` (computed from items)
- `confirmed` (bool) — false = draft from the model, true = user has reviewed/corrected

**FoodItem**
- `id`, `meal_id`
- `name`
- `source` — `"photo"` (macros from USDA via vision estimate) or `"barcode"` (macros from Open Food Facts label data)
- `estimated_portion_g` — from the vision model (nullable for barcode-only items)
- `confirmed_portion_g` — set by the user (defaults to estimate until corrected)
- `calories`, `protein_g`, `carbs_g`, `fat_g` — per the source DB, scaled to the confirmed portion
- `fdc_id` (nullable) — reference to the USDA FoodData Central record used (photo source)
- `barcode` (nullable) — EAN-13 / UPC of the scanned product (barcode source)

**WeeklyCheckin** (the weekly progress record — photo + body measurements)
- `id`, `timestamp`
- `photo_path` (nullable — user may log measurements without a photo, or vice versa)
- `weight_kg` (nullable)
- `waist_cm`, `chest_cm`, `hips_cm`, `arm_cm`, `thigh_cm` (all nullable — record what you want)
- `notes` (nullable)

> These body measurements are for **progress tracking** and are completely separate
> from the hand measurement in section 5a (which is only a photo scale reference).

**Goal** (a single active goal; keep the current one, allow updating it)
- `id`, `created_at`, `active` (bool)
- Daily targets (all nullable): `calorie_target`, `protein_target_g`,
  `carb_target_g`, `fat_target_g`
- `training_days_per_week` (nullable) — optional exercise target
- Body goal (optional): `target_weight_kg` (nullable), `target_date` (nullable)

**DailyEvaluation** (the end-of-day summary for one date)
- `id`, `date` (one per day)
- Computed day totals: `total_calories`, `total_protein_g`, `total_carbs_g`,
  `total_fat_g`, `exercises_logged` (count or list)
- `summary_text` — a short, constructive written evaluation (see section 6a)
- `created_at`

## 5a. User settings (hand scale reference)

A single set of personal settings, stored simply (a `settings` key/value table, or
in `config.py` — this is a single-user local app). Includes the user's own
measured hand dimensions, used as a scale reference for photo portion estimates:

- `index_finger_cm` (nullable) — measured length of the reference index finger
- `hand_length_cm` (nullable) — full wrist-to-fingertip length
- `palm_width_cm` (nullable) — optional additional reference

The user measures these once and enters them. When present, `vision.py` injects the
relevant measurement into the food-photo prompt (see section 6, step 3). All
nullable: if unset, the pipeline works exactly as before, just without the extra
reference. This improves the *area* estimate (how wide/long the food is); it does
**not** solve height/volume of stacked foods — the correction step still covers that.

## 6. The food → macros pipeline (the important part)

This is the only non-trivial flow. Implement it exactly in this order:

1. Phone captures a photo → `POST /meals/photo` (multipart upload).
2. Backend saves the image to `data/photos/` with a timestamped filename.
3. `vision.py` sends the image to LM Studio and asks the model to return, as
   **strict JSON**, a list of `{ "name": ..., "estimated_portion_g": ... }`.
   The model identifies food and estimates portion size **only** — it must not
   output calories or macros.
   - **Scale reference:** if the user has saved hand measurements (see section 5a),
     `vision.py` includes them in the prompt, e.g. "the index finger placed flat
     next to the plate is exactly 8.2 cm long; use it as a size reference for
     portion estimates." This gives the model a real, user-specific scale instead
     of guessing absolute sizes. The user should lay the reference finger/hand flat
     next to the plate, in the same plane as the food (not hovering above it).
4. `nutrition.py` maps each identified food name to a USDA FoodData Central
   record and pulls per-100g macros, then scales them to the estimated portion.
   These items have `source = "photo"`.
5. Backend returns a **draft Meal** (`confirmed = false`) to the phone.
6. On the phone, the user reviews each item, corrects portions where the estimate
   is off, and can remove/add items → `PATCH /meals/{id}`.
7. Backend recomputes macros from the confirmed portions and saves the meal with
   `confirmed = true`.

**Optional barcode step (between 6 and 7).** For any packaged product, the user can
scan its barcode instead of relying on the photo estimate:

- a. The PWA reads the EAN-13 / UPC from the camera (client-side, on the phone).
- b. The barcode is sent to `POST /barcode/{code}`.
- c. `barcode.py` looks the code up in the **local Open Food Facts copy** and returns
  the product name + exact per-100g macros from the label.
- d. This becomes a `FoodItem` with `source = "barcode"`, its `barcode` set, and no
  `estimated_portion_g`. The user still enters **how much** they ate (grams, or a
  serving count if the product lists a serving size); macros scale to that amount.
- e. If the barcode is not found locally, tell the user and let them fall back to a
  manual entry — never call the Open Food Facts online API.

**Why:** portion estimation from a single 2D photo is the weak point of every
food-tracking system. The design absorbs that by making the model's output a
*first draft* the user confirms, and by sourcing macro numbers from a verified
database rather than the model. The barcode path removes even the identification
guesswork for packaged items — the per-100g macros come straight from the label.
In both paths the user always confirms the amount; never skip the confirmation step.

## 6a. End-of-day evaluation flow

When the user finishes their day (taps "End my day", or opens the evaluation for a
past date), produce a short, constructive summary of how the day went against the goal.

1. `evaluation.py` gathers the day's data: all confirmed meals for that date (summed
   into total calories + macros) and all exercises logged that date.
2. It loads the active `Goal` and compares totals to the daily targets (e.g. protein
   hit? calories over/under? trained today?).
3. It asks the local model (LM Studio) to write a brief natural-language evaluation
   from those numbers. The comparison itself is plain arithmetic in code — the model
   only phrases it. So if the model is unavailable, still show the numbers vs targets.
4. Store the result as a `DailyEvaluation` (one per date) and show it to the user.

**Tone (required — put this in the model's system prompt):**
- Be supportive and constructive, like a good coach. Report the facts, highlight what
  went well, and suggest at most one thing to adjust tomorrow.
- **No judgment, guilt, or shaming language. Never call a day a "failure".** Do not
  moralize about specific foods (no "good/bad food"). Frame around the user's own
  targets and around consistency over time, not single-day perfection.
- Keep it to a few sentences.

**Why this framing:** an evaluation that motivates gets used for months; one that
punishes gets deleted in a week. Constructive framing is the correct product design
here, not an afterthought.

## 7. API endpoints

- `GET  /`                    → serve the PWA (index.html)
- `POST /exercises`           → create an exercise log
- `GET  /exercises`           → list exercises (most recent first)
- `POST /meals/photo`         → upload a food photo, run the pipeline, return a draft meal
- `POST /barcode/{code}`      → look up a barcode in the local Open Food Facts copy, return product + per-100g macros
- `PATCH /meals/{id}`         → submit corrected portions (and any barcode items), recompute + confirm the meal
- `GET  /meals`               → list meals (most recent first)
- `POST /checkins`            → weekly check-in: photo + body measurements + weight
- `GET  /checkins`            → list weekly check-ins (most recent first)
- `GET  /goal`                → get the active goal
- `PUT  /goal`                → set / update the active goal (daily targets + optional body goal)
- `POST /evaluation/{date}`   → compute + store the end-of-day evaluation for a date
- `GET  /evaluation/{date}`   → get a stored evaluation (default today)

All endpoints are reachable only over the user's own network (home wifi) or their
private Tailscale tunnel. No public exposure. No authentication in v1 (the tailnet
is the security boundary — only the user's own devices can reach it).

**PWA install requirement:** `manifest.json` must set `"display": "standalone"`, a
name, and app icons so the PWA installs to the phone's home screen and opens
full-screen (no browser chrome), behaving like a native app. A service worker is
needed for installability; keep it minimal (it does not need full offline support
in v1, since the app requires the Mac to function).

## 8. Repo structure

```
backend/
  main.py        # FastAPI app: API routes + serves the PWA
  database.py    # SQLite/SQLModel setup + session helper
  models.py      # SQLModel definitions: Exercise, Meal, FoodItem, WeeklyCheckin, Goal, DailyEvaluation
  nutrition.py   # look up + scale macros from the local USDA database (photo source)
  barcode.py     # look up a barcode in the local Open Food Facts DB (barcode source)
  vision.py      # send a food photo to LM Studio, parse JSON food + portion estimates
  evaluation.py  # sum a day vs the goal, ask the local model for a constructive summary
  config.py      # settings: storage paths, LM Studio URL/port, db path, hand measurements
frontend/
  index.html     # PWA shell (tabs: Today / Food / Exercise / Check-in / Goal)
  app.js         # camera capture, barcode scanning, fetch calls to the backend
  sw.js          # minimal service worker (required for PWA install)
  manifest.json  # PWA manifest (standalone display, name, icons)
data/
  photos/            # stored images (git-ignored)
  usda/              # USDA FoodData Central import (git-ignored)
  openfoodfacts/     # Open Food Facts Parquet dump + imported table (git-ignored)
requirements.txt
README.md
.gitignore
```

## 9. Out of scope (do NOT build these)

- Any cloud service, external API, or hosted database.
- User accounts, login, or multi-user support.
- A native iOS/Android app (PWA only — installed to the home screen for an
  app-like experience; see section 3 and the PWA install requirement in section 7).
- The vision model producing final macro numbers (it estimates portions only).
- Exposing the Mac to the public internet by opening router ports. Remote access is
  supported, but **only** via the Tailscale private tunnel — never public exposure.

## 10. Conventions for the agent

- Use type hints and a short docstring on every module and public function.
- Keep changes small and reviewable; implement one endpoint or module at a time.
- Do not add a dependency without adding it to `requirements.txt` and noting why.
- All prompts sent to the vision model must demand strict JSON output and the code
  must parse it defensively (handle malformed responses without crashing).
- Store paths and the LM Studio URL/port in `config.py` — never hard-code them.
- The end-of-day evaluation must use supportive, non-judgmental language (see section
  6a). The goal is honest feedback that motivates, never guilt or shaming. Compute the
  numeric comparison in code so the feature works even if the model is unavailable.

## 11. Build order

1. Scaffold the structure (files + stubs, no logic).
2. Database + models + `config.py`.
3. Exercise logging (simplest full slice: API + a tab in the PWA).
4. Weekly check-in: photo + body measurements + weight (upload + list).
5. Goal: set/get daily targets (+ optional body goal) with a Goal tab.
6. Food pipeline: `vision.py` → `nutrition.py` → draft meal → correction → save.
   Include the optional hand-measurement scale reference in the vision prompt
   (settings from section 5a), and a small settings screen to enter the measurements.
7. USDA FoodData Central import into SQLite.
8. End-of-day evaluation: `evaluation.py` (sum day vs goal in code) + the local-model
   summary + a "Today" tab that shows the day's totals vs targets and the evaluation.
9. Barcode path: import Open Food Facts (Parquet → SQLite), `barcode.py`, the
   `POST /barcode/{code}` endpoint, and barcode scanning in the PWA.
10. Polish the PWA (camera UX, correction screen, barcode-scan UX, simple trend charts
    for weight/measurements over time).
11. PWA install: `manifest.json` (standalone, icons) + minimal `sw.js` so it installs
    to the home screen and opens full-screen.
12. Remote access: set up Tailscale on the Mac and phone, serve the app over the
    Tailscale HTTPS hostname, and confirm the same URL works at home and away.

Steps 11–12 are the "make it feel like a real app on my phone, usable anywhere"
layer. They come last: get the core working over local wifi first, then wrap it.
