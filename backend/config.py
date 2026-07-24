import os
from dotenv import load_dotenv
load_dotenv()

MODEL_NAME = os.getenv("MODEL_NAME", "gemma-4-31b-it-uncensored")
MODEL_PATH = os.getenv("MODEL_PATH", "/home/user/chatbot/models/gemma-4-31b")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "4096"))
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
