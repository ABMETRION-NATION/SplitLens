"""
SplitLens backend — minimal FastAPI scaffold.

Intentionally lightweight: the mobile app works fully offline for all core
features. These endpoints are placeholders so the frontend can later switch
from inline/simulated logic to a real backend (e.g. real OCR) without any
client refactor.
"""
from fastapi import FastAPI, APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import logging
import random


app = FastAPI(title="SplitLens API", version="0.1.0")
api_router = APIRouter(prefix="/api")


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class ReceiptScanResponse(BaseModel):
    ok: bool
    total: Optional[float] = None
    currency: str = "USD"
    source: str  # "simulated" | "ocr"
    message: str


@api_router.get("/", response_model=HealthResponse)
async def root() -> HealthResponse:
    return HealthResponse(status="ok", service="splitlens", version="0.1.0")


@api_router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="splitlens", version="0.1.0")


@api_router.post("/receipt/scan", response_model=ReceiptScanResponse)
async def scan_receipt(file: UploadFile = File(...)) -> ReceiptScanResponse:
    """
    Placeholder receipt scan endpoint.

    Accepts an uploaded receipt image and returns a *simulated* total so the
    frontend flow is fully wired. Swap the body of this function with a real
    OCR provider (GPT-4o vision, Google Vision, Textract, etc.) later — the
    response contract stays the same.
    """
    try:
        contents = await file.read()
        size_kb = len(contents) / 1024.0
        # Deterministic-but-realistic simulated amount so it feels real.
        random.seed(int(size_kb * 100) or 7)
        total = round(random.uniform(18, 187), 2)
        return ReceiptScanResponse(
            ok=True,
            total=total,
            currency="USD",
            source="simulated",
            message=f"Simulated total extracted from {size_kb:.1f} KB image.",
        )
    except Exception as exc:  # pragma: no cover - defensive for placeholder
        logging.exception("receipt scan failed")
        return ReceiptScanResponse(
            ok=False,
            total=None,
            source="simulated",
            message=f"Scan failed: {exc}. Fall back to manual entry.",
        )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request, exc):  # pragma: no cover
    logging.exception("unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"ok": False, "message": f"Internal error: {exc}"},
    )
