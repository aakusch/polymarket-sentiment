"""Refresh latest_score for public indicators."""

from __future__ import annotations

import logging
import os

import click

from indicator_scores import update_latest_scores

log = logging.getLogger(__name__)


@click.command()
@click.option("-v", "--verbose", is_flag=True)
def main(verbose: bool):
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%H:%M:%S",
    )

    database_url = (os.environ.get("DATABASE_URL") or "").replace("\\n", "").strip()
    if not database_url:
        raise click.ClickException("DATABASE_URL required")

    import psycopg

    with psycopg.connect(database_url) as conn:
        count = update_latest_scores(conn)

    click.echo(f"Updated latest_score for {count} public indicators")


if __name__ == "__main__":
    main()
