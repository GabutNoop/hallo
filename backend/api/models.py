from fastapi import APIRouter

router = APIRouter()

@router.get("/api/models")
async def models():
    return {
        "models": [
            {"id": "gemma-4-31b-it-uncensored", "name": "Gemma 4 31B It Uncensored", "available": False},
            {"id": "dummy", "name": "Dummy / Sandbox Mode", "available": True}
        ]
    }
