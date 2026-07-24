from fastapi import APIRouter
from backend.config import MODEL_NAME, MODEL_PATH
import os

router = APIRouter()

@router.get("/api/health")
async def health():
    model_found = os.path.exists(MODEL_PATH) and bool(os.listdir(MODEL_PATH))
    return {
        "status": "ok",
        "model_name": MODEL_NAME,
        "model_loaded": model_found,
        "service": "hallo-chatbot"
    }
