import logging
import datetime

AUDIT_LOG = "backend/audit.log"

def log_request(message: str, result: str, blocked: bool = False):
    timestamp = datetime.datetime.now().isoformat()
    status = "BLOCKED" if blocked else "ALLOWED"
    entry = f"[{timestamp}] [{status}] MSG: {message[:200]} | RESULT: {result[:200]}\n"
    with open(AUDIT_LOG, "a") as f:
        f.write(entry)
    logging.info(f"Audit [{status}]: {message[:50]}...")
