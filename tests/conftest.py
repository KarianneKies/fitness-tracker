"""Shared test fixtures.

Every test run gets its own empty SQLite file via the FITNESS_TRACKER_DB
env var, set before backend.config is imported, so tests never touch the
real app.db.
"""

import os
import tempfile

import pytest

# Point the app at a throwaway DB *before* importing anything from backend
# (backend.database builds its engine from config.DATABASE_PATH at import time).
_db_fd, _db_path = tempfile.mkstemp(prefix="fitness_test_", suffix=".db")
os.close(_db_fd)
os.environ["FITNESS_TRACKER_DB"] = _db_path

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    # `with TestClient(...)` runs the startup event -> create_db_and_tables()
    with TestClient(app) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    try:
        os.remove(_db_path)
    except OSError:
        pass
