# database.py — SQLModel and SQLite setup

"""
Database configuration for the Fitness Tracker application.

This module sets up:
- The SQLModel/SQLAlchemy engine and session
- A helper function to get a database session
"""

from contextlib import contextmanager
from typing import Iterator

from sqlmodel import SQLModel, create_engine, Session

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
    """
    SQLModel.metadata.create_all(engine)


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