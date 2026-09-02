# config.py — Application settings

"""
Configuration for the Fitness Tracker application.

This module provides centralized settings for:
- Database path
- Photo storage location
- LM Studio vision model endpoint
- User hand measurements (for photo portion scaling)
"""

from typing import Optional
import os

# Get the project root directory (parent of backend/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Frontend directory (serves the PWA)
FRONTEND_DIR: str = os.path.join(PROJECT_ROOT, "frontend")

# Database. Override with FITNESS_TRACKER_DB (used by the test suite to
# point at a throwaway file instead of the real app.db).
DATABASE_PATH: str = os.environ.get("FITNESS_TRACKER_DB") or os.path.join(PROJECT_ROOT, "app.db")

# File storage paths
PHOTOS_DIR: str = os.path.join(PROJECT_ROOT, "data", "photos")

# LM Studio (vision model) endpoint - OpenAI-compatible
LM_STUDIO_URL: str = "http://localhost:3142/v1"

# Vision model identifier as loaded in LM Studio. Some LM Studio setups accept
# a generic alias like "local"; this one requires the exact loaded model id
# (check `curl http://localhost:3142/v1/models` if this ever needs updating).
LM_STUDIO_VISION_MODEL: str = "qwen/qwen3-vl-30b"

# User hand measurements (optional - for photo portion estimates)
# These should be set by the user via the settings UI
HAND_MEASUREMENTS: dict[str, Optional[float]] = {
    "index_finger_cm": None,
    "hand_length_cm": None,
    "palm_width_cm": None,
}
