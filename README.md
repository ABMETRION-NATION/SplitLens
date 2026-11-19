# SplitLens

A fast, offline-first bill-splitting mobile app with optional receipt awareness.

## Features
- **Split calculator** – bill amount, tip presets (10/15/18/20/25%) + custom tip, live per-person / tip / total.
- **Named people** – switch from a simple count to named people; evenly split across names.
- **Receipt scan (light)** – upload a receipt image; backend endpoint returns a simulated total. Falls back to a local simulated total if the backend is unreachable, so the app never blocks.
- **Local memory** – last split and named group persisted with `AsyncStorage`.
- **Round up per person** toggle and **quick reset** button.

## Stack
- **Frontend:** React Native (Expo SDK 54, expo-router).
- **Backend (optional scaffold):** FastAPI with `/api/health` and `/api/receipt/scan` placeholder endpoints. The app works fully without it.

## Run

### Frontend
```bash
cd frontend
yarn install
yarn start   # or: yarn ios / yarn android / yarn web
```

### Backend (optional)
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

The frontend picks up the backend URL from `frontend/.env` → `EXPO_PUBLIC_BACKEND_URL`. If the backend is offline, receipt scanning automatically falls back to a local simulated total.

## Expanding later
`POST /api/receipt/scan` in `backend/server.py` is a drop-in seam for a real OCR provider (GPT-4o vision, Google Vision, Textract, etc.). The frontend contract already expects `{ ok, total, currency, source, message }`, so no client changes are needed when you upgrade.

## Project layout
```
frontend/
  app/
    _layout.tsx        # expo-router root layout
    index.tsx          # SplitLens main screen
  app.json             # name/slug set to SplitLens
backend/
  server.py            # FastAPI scaffold (health + receipt/scan placeholder)
  requirements.txt
```


## Public-safe project context — 2026-11-18 (DRAFT)

See [Project Working Context](docs/governance/PUBLIC_PROJECT_CONTEXT.md) for a source-first orientation and public-safe principles on ownership, usability, verification and release scope. This draft contains no internal Nation charter or owner-private data. It is not a legal notice, launch claim, new product feature or permission to publish.
