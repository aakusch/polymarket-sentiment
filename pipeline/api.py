"""Optional FastAPI server for querying sentiment scores."""

import json
from typing import Optional

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from db import Database

app = FastAPI(title="Polymarket Sentiment API", version="0.1.0")


def get_db() -> Database:
    return Database()


@app.get("/")
def root():
    return {"service": "polymarket-sentiment", "version": "0.1.0"}


@app.get("/latest")
def latest(sector: str = "crypto"):
    """Get the latest sector sentiment snapshot."""
    db = get_db()
    with db:
        d = db.get_latest_date(sector)
        if not d:
            return JSONResponse({"error": "no data"}, status_code=404)
        ts = db.get_sector_timeseries(sector, start=d, end=d)
        markets = db.get_market_snapshots(d)
    row = ts[0] if ts else {}
    row["top_markets"] = markets[:20]
    if row.get("sub_scores_json"):
        row["sub_scores"] = json.loads(row["sub_scores_json"])
        del row["sub_scores_json"]
    if "raw_json" in row:
        del row["raw_json"]
    return row


@app.get("/timeseries")
def timeseries(
    sector: str = "crypto",
    start: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
):
    """Get sector sentiment composite over time."""
    db = get_db()
    with db:
        rows = db.get_sector_timeseries(sector, start=start, end=end)
    for row in rows:
        if "raw_json" in row:
            del row["raw_json"]
        if row.get("sub_scores_json"):
            row["sub_scores"] = json.loads(row["sub_scores_json"])
            del row["sub_scores_json"]
    return {"sector": sector, "count": len(rows), "data": rows}


@app.get("/markets/{snapshot_date}")
def markets(snapshot_date: str, sector: str = "crypto"):
    """Get per-market scores for a specific date."""
    db = get_db()
    with db:
        rows = db.get_market_snapshots(snapshot_date)
    return {"date": snapshot_date, "count": len(rows), "markets": rows}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100)
