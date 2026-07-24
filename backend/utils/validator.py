from typing import Any, Dict

def validate_chat_input(data: Dict[str, Any]) -> bool:
    message = data.get("message", "")
    return isinstance(message, str) and len(message) > 0 and len(message) < 10000
