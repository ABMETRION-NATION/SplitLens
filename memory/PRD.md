# SplitLens — Product Requirements Document

## Summary
A fast, offline-first mobile bill-splitting app with optional receipt awareness. Built on React Native (Expo SDK 54, expo-router) with a thin FastAPI backend scaffold.

## Goals
- Feel like a smart upgrade over a basic tip calculator.
- Usable instantly (no login, no network required).
- Scaffolded so receipt OCR can be upgraded later without client changes.

## Features (shipped)
1. **Split calculator** — bill input, tip presets (10/15/18/20/25%) + custom %, live per-person / tip / total.
2. **People** — numeric stepper OR named-people mode with add/remove via bottom sheet.
3. **Receipt scan (light)** — upload image, POST to `/api/receipt/scan`, receive simulated total. Falls back to local simulated total if backend unreachable.
4. **Local memory** — full calculator state persisted via AsyncStorage (`splitlens:lastSplit:v1`).
5. **Polish** — round-up-per-person toggle, quick reset.

## Design
- Theme: dark obsidian (#09090B) + "Safety Yellow" accent (#FFD600).
- Hero per-person amount is the screen's anchor; secondary stats below.
- Haptics on every interaction (native only).
- Icons via `@expo/vector-icons` (Feather).

## Tech
- **Frontend:** Expo SDK 54, expo-router, AsyncStorage, expo-image-picker, expo-haptics.
- **Backend:** FastAPI with only `/api/health` and `/api/receipt/scan`. MongoDB not used.
- Frontend calls backend via `EXPO_PUBLIC_BACKEND_URL`; works offline because every API call has a local fallback.

## Extension seam
`POST /api/receipt/scan` returns `{ok, total, currency, source, message}`. Swap the handler body with a real OCR (GPT-4o vision, Google Vision, Textract) — zero client changes needed.

## Not in scope (deferred)
- Uneven / item-level split assignment from OCR line items.
- Cloud sync or multi-device history.
- Auth / accounts.
