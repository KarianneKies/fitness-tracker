# database.py — SQLModel and SQLite setup

"""
SQLModel configuration for the Fitness Tracker application.

This module sets up:
- The SQLModel/SQLAlchemy engine and session
- A helper function to get a database session
"""

from contextlib import contextmanager
from typing import Iterator

import sqlite3
from sqlmodel import SQLModel, create_engine, Session, text

from .config import DATABASE_PATH

# Create the SQLite engine
engine = create_engine(
    f"sqlite:///{DATABASE_PATH}",
    echo=False,  # Set to True for SQL logging
    connect_args={"check_same_thread": False},  # Required for SQLite with threading
)


def create_db_and_tables() -> None:
    """
    Create all database tables based on defined SQLModel classes.
    
    This should be called once on application startup.
    Also runs any pending data migrations.
    """
    SQLModel.metadata.create_all(engine)
    run_data_migrations()


def run_data_migrations() -> None:
    """
    Run data migrations to handle schema changes.
    
    Adds new columns and migrates existing data as needed.
    """
    # Use raw SQLite connection for migrations since ALTER TABLE doesn't work well
    # with SQLModel's Session in some cases
    conn = engine.connect()
    try:
        # Migration: Add 'name' column to workouts if it doesn't exist
        conn.execute(text("ALTER TABLE workouts ADD COLUMN name TEXT"))
        # Column was added, now migrate existing data: move notes to name
        # only if the workout doesn't already have a proper name set.
        # For imported workouts where name was stored in notes, copy to name field
        conn.execute(text("UPDATE workouts SET name = notes WHERE name IS NULL AND notes IS NOT NULL"))
        # Clear notes that contained the workout name (after migration, notes should only contain real notes)
        conn.execute(text("UPDATE workouts SET notes = NULL WHERE name IS NOT NULL AND notes IS NOT NULL"))
        conn.commit()
    except Exception as e:
        # Column already exists or other error - this is expected on subsequent runs
        conn.rollback()
    finally:
        conn.close()


@contextmanager
def get_session() -> Iterator[Session]:
    """
    Context manager that provides a database session.
    
    Usage:
        with get_session() as session:
            # perform DB operations
            pass
    """
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()
