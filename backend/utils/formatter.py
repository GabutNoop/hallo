def format_response(text: str, model_name: str = "gemma-4-31b-it-uncensored") -> str:
    return f"[{model_name}] {text}"
