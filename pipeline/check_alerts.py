"""Check alert thresholds after daily export and send notifications."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

import click
import requests

from indicator_scores import compute_latest_score, fetch_public_indicators

log = logging.getLogger(__name__)

DATABASE_URL = (os.environ.get("DATABASE_URL") or "").replace("\\n", "").strip()
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FROM_EMAIL = os.environ.get("ALERT_FROM_EMAIL", "alerts@pmsi.app")


def get_db_connection():
    """Get a database connection using DATABASE_URL."""
    import psycopg
    return psycopg.connect(DATABASE_URL)


def compute_latest_scores(conn) -> dict[str, float]:
    """Compute latest score for all public indicators with alerts."""
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT a.indicator_id
        FROM alerts a
        WHERE a.enabled = true
    """)
    indicator_ids = [row[0] for row in cur.fetchall()]
    if not indicator_ids:
        return {}

    scores = {}
    for indicator in fetch_public_indicators(conn, indicator_ids):
        score = compute_latest_score(conn, indicator)
        if score is not None:
            scores[indicator["id"]] = score

    return scores


def check_and_fire_alerts(conn, scores: dict[str, float]):
    """Check each enabled alert against latest scores and fire if triggered."""
    cur = conn.cursor()
    cur.execute("""
        SELECT a.id, a.indicator_id, a.condition, a.threshold, a.channel,
               a.destination, a.last_score, i.name as indicator_name
        FROM alerts a
        JOIN indicators i ON a.indicator_id = i.id::text
        WHERE a.enabled = true
    """)
    alerts = cur.fetchall()
    now = datetime.now(timezone.utc)

    for alert_id, ind_id, condition, threshold, channel, destination, last_score, ind_name in alerts:
        current = scores.get(ind_id)
        if current is None:
            continue

        triggered = False

        if condition == "crosses_above" and threshold is not None:
            if last_score is not None and float(last_score) <= float(threshold) and current > float(threshold):
                triggered = True
            elif last_score is None and current > float(threshold):
                triggered = True

        elif condition == "crosses_below" and threshold is not None:
            if last_score is not None and float(last_score) >= float(threshold) and current < float(threshold):
                triggered = True
            elif last_score is None and current < float(threshold):
                triggered = True

        elif condition == "daily_summary":
            triggered = True  # Always fire for daily summaries

        if triggered:
            msg = format_alert_message(ind_name, condition, threshold, current, last_score)
            send_alert(channel, destination, ind_name, msg)
            cur.execute(
                "UPDATE alerts SET last_triggered_at = %s, last_score = %s WHERE id = %s",
                (now, current, alert_id),
            )
            log.info("Alert %s fired: %s → %s (%s)", alert_id, ind_name, condition, channel)
        else:
            # Update last_score even if not triggered
            cur.execute("UPDATE alerts SET last_score = %s WHERE id = %s", (current, alert_id))

    conn.commit()


def format_alert_message(name, condition, threshold, current, previous):
    """Format a human-readable alert message."""
    prev_str = f"{float(previous):.1f}" if previous is not None else "N/A"
    if condition == "daily_summary":
        return f"{name}: Current score {current:.1f}/100 (previous: {prev_str})"
    direction = "above" if condition == "crosses_above" else "below"
    return f"{name} crossed {direction} {float(threshold):.0f}: now {current:.1f}/100 (was {prev_str})"


def send_alert(channel, destination, subject, message):
    """Send alert via configured channel."""
    if channel == "email":
        send_email_alert(destination, subject, message)
    elif channel == "webhook":
        send_webhook_alert(destination, subject, message)
    elif channel == "discord":
        send_discord_alert(destination, subject, message)


def send_email_alert(to, subject, message):
    """Send email via Resend API."""
    if not RESEND_API_KEY:
        log.warning("RESEND_API_KEY not set, skipping email to %s", to)
        return
    try:
        requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={
                "from": FROM_EMAIL,
                "to": [to],
                "subject": f"PMSI Alert: {subject}",
                "text": message,
            },
            timeout=10,
        )
    except Exception as e:
        log.error("Email send failed: %s", e)


def send_webhook_alert(url, subject, message):
    """POST JSON to webhook URL."""
    try:
        requests.post(
            url,
            json={"indicator": subject, "message": message, "timestamp": datetime.now(timezone.utc).isoformat()},
            timeout=10,
        )
    except Exception as e:
        log.error("Webhook failed: %s", e)


def send_discord_alert(webhook_url, subject, message):
    """Send to Discord webhook."""
    try:
        requests.post(
            webhook_url,
            json={"content": f"**PMSI Alert: {subject}**\n{message}"},
            timeout=10,
        )
    except Exception as e:
        log.error("Discord webhook failed: %s", e)


def fire_webhooks(conn, scores: dict[str, float]):
    """Fire webhook deliveries for indicators with updated scores."""
    import hmac
    import hashlib

    cur = conn.cursor()
    cur.execute("""
        SELECT w.id, w.indicator_id, w.url, w.secret, w.events, i.name as indicator_name
        FROM webhooks w
        JOIN indicators i ON w.indicator_id = i.id::text
        WHERE w.enabled = true
    """)
    webhooks = cur.fetchall()
    now = datetime.now(timezone.utc)

    for wh_id, ind_id, url, secret, events, ind_name in webhooks:
        current = scores.get(ind_id)
        if current is None:
            continue

        if "score_update" not in (events or []):
            continue

        payload = json.dumps({
            "event": "score_update",
            "indicator_id": ind_id,
            "indicator_name": ind_name,
            "score": current,
            "timestamp": now.isoformat(),
        })

        # HMAC-SHA256 signature
        sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

        try:
            resp = requests.post(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-PMSI-Signature": f"sha256={sig}",
                    "X-PMSI-Event": "score_update",
                },
                timeout=10,
            )
            log.info("Webhook %s → %s: %d", wh_id, url[:50], resp.status_code)
            cur.execute(
                "UPDATE webhooks SET last_delivered_at = %s WHERE id = %s",
                (now, wh_id),
            )
        except Exception as e:
            log.error("Webhook %s failed: %s", wh_id, e)

    conn.commit()


@click.command()
@click.option("-v", "--verbose", is_flag=True)
def main(verbose):
    """Check alert thresholds and send notifications."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%H:%M:%S",
    )

    if not DATABASE_URL:
        log.error("DATABASE_URL not set")
        return

    conn = get_db_connection()
    try:
        scores = compute_latest_scores(conn)
        log.info("Computed scores for %d indicators", len(scores))
        check_and_fire_alerts(conn, scores)
        fire_webhooks(conn, scores)
    finally:
        conn.close()

    click.echo("Alert + webhook check complete")


if __name__ == "__main__":
    main()
