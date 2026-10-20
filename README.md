# SmartPick
Parcel locator hardware module - Embedded systems Project

## Backend and frontend

Requires Node.js 20+. The backend connects to the existing Neon database and never runs schema setup SQL.

In `backend/`, copy `.env.example` to `.env`, set `DATABASE_URL`, distinct `OPERATOR_API_KEY` and `ESP32_API_KEY`, then run `npm install`, `npm run build`, and `npm start`. Use `npm run dev` during development.

In `frontend/`, copy `.env.example` to `.env`, set `VITE_OPERATOR_API_KEY` to the same operator key, then run `npm install` and `npm run dev`. Set `CORS_ORIGIN` in the backend to the frontend origin when it differs from `http://localhost:5173`. The frontend is a small parcel desk for registration, student lookup, compartment status, and retrieval command requests. See [backend/ESP32_API.md](backend/ESP32_API.md) for ESP32 requests and [docs/database.md](docs/database.md) for the existing schema overview.
