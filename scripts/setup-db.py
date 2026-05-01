#!/usr/bin/env python3
"""Initialize the production Postgres database for PMSI."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "api" / "_lib" / "schema.sql"
ENV_FILES = (ROOT / ".env.local", ROOT / ".env")


def load_local_env() -> None:
    for path in ENV_FILES:
        if not path.exists():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'").replace("\\n", "").strip()
            if key and key not in os.environ:
                os.environ[key] = value


def main() -> int:
    load_local_env()
    database_url = (os.environ.get("DATABASE_URL") or "").replace("\\n", "").strip()
    if not database_url:
        print("DATABASE_URL is required. Add it to .env.local or export it in your shell.")
        return 1

    schema_sql = SCHEMA.read_text()
    print("Applying schema:", SCHEMA.relative_to(ROOT))
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN (
                    'users', 'indicators', 'api_keys', 'api_usage',
                    'payments', 'indicator_comments', 'pipeline_runs'
                  )
                ORDER BY table_name
                """
            )
            tables = [row[0] for row in cur.fetchall()]
        conn.commit()

    print("Database ready. Tables:", ", ".join(tables))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
