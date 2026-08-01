# Fitness Tracker

A personal health tracking application built with FastAPI (backend) and vanilla JavaScript (frontend).

## Features

- Track daily meals and food intake
- Log exercise activities
- Monitor weekly check-ins (body measurements)
- Set and track health goals
- Daily self-evaluation

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLModel, SQLite
- **Frontend**: Vanilla HTML/CSS/JS (PWA)
- **Vision/Language Model**: LM Studio (OpenAI-compatible API)

## Project Structure

```
fitness-tracker/
├── backend/
│   ├── main.py          # FastAPI app with health check
│   ├── database.py      # SQLModel + SQLite setup
│   ├── models.py        # Database models (Exercise, Meal, FoodItem, etc.)
│   ├── config.py        # Application configuration
│   ├── nutrition.py     # Nutrition analysis stub
│   ├── barcode.py       # Barcode scanning stub
│   ├── vision.py        # LM Studio integration stub
│   └── evaluation.py    # Daily evaluation stub
├── frontend/
│   ├── index.html       # PWA shell with tabs
│   ├── app.js           # Frontend logic
│   ├── sw.js            # Service worker
│   └── manifest.json    # PWA manifest
├── data/photos/         # User photos (git-ignored)
└── requirements.txt     # Python dependencies
```

## How to Run

1. Install Python 3.11+

2. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Start LM Studio and launch a local server (e.g., on port 3142)

5. Run the backend:
   ```bash
   cd backend
   uvicorn main:app --reload
   ```

6. Open `http://localhost:8000` in your browser

## Configuration

The application reads configuration from `backend/config.py`. Key settings:
- Database path: SQLite file location
- Data directory: For photos and external data files
- LM Studio URL: OpenAI-compatible API endpoint

## Data Privacy

All personal health data is stored locally in SQLite. The `data/` directory (including photos) is git-ignored to prevent accidental commits of sensitive information.
