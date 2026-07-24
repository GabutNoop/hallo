import re
import logging

logger = logging.getLogger(__name__)

# Pola berbahaya untuk filter defensif
DANGEROUS_PATTERNS = [
    r"(?i)eval\s*\(", r"(?i)exec\s*\(", r"(?i)system\s*\(",
    r"(?i)rm\s+-rf", r"(?i)del\s+/", r"(?i)format\s+c:",
    r"(?i)\bmalware\b", r"(?i)\bworm\b", r"(?i)\bransomware\b",
    r"(?i)\bexploit\b", r"(?i)\bpayload\b",
    r"(?i)drop\s+table", r"(?i)delete\s+.*from",
    r"(?i)\bkill\b.*\bprocess\b", r"(?i)\bpwn\b", r"(?i)\brce\b",
    r"(?i)\.exec\b.*\bpython\b", r"(?i)os\.system",
    r"(?i)shellcode", r"(?i)reverse\s+shell",
    r"(?i)\bprivilege\b.*\bescalation\b", r"(?i)\backdoor\b",
]

INJECTION_PATTERNS = [
    r"(?i)ignore\s+previous", r"(?i)system\s+prompt",
    r"(?i)you\s+are\s+now\s+.*\badmin\b",
    r"(?i)\bDAN\b.*\bmode\b", r"(?i)\bdeveloper\b.*\bmode\b",
    r"(?i)\buncensored\b", r"(?i)\bno\s+filter\b",
    r"(?i)\bignore\b.*\brules\b", r"(?i)\bforget\b.*\brules\b",
]

def scan_input(text: str) -> dict:
    result = {"blocked": False, "reason": "", "match": ""}
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, text):
            result["blocked"] = True
            result["reason"] = "dangerous_content"
            result["match"] = pattern
            logger.warning(f"Dangerous content detected: {pattern}")
            return result
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text):
            result["blocked"] = True
            result["reason"] = "prompt_injection"
            result["match"] = pattern
            logger.warning(f"Injection attempt detected: {pattern}")
            return result
    return result

def sanitize_text(text: str) -> str:
    # Bersihkan karakter berbahaya dasar
    text = text.replace("\x00", "")
    text = text.replace("\r", " ")
    return text
