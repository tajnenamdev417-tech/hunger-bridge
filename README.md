# Hunger Bridge

Real-time surplus food redistribution platform.

## Architecture
- Backend: Node.js + Express + Socket.IO
- Frontend: React + Vite + Leaflet maps
- In-memory store for demo; replace with MongoDB/Postgres for production

## Setup
### Backend
cd backend
npm install
npm run start

### Frontend
cd frontend
npm install
npm run dev

## Features
- Role-based users: donor, NGO, volunteer
- Donor creates surplus food postings (expiry 1-120 minutes)
- Real-time post status updates via Socket.IO
- Auto matching nearest volunteer based on geo distance and expiry
- NGO claim and volunteer delivery endpoints
- Analytics dashboard (meals saved, avg delivery time)
- Map-based UI and live updates

## API endpoints
- POST /api/register
- POST /api/posts
- GET /api/posts
- POST /api/posts/:id/claim
- POST /api/posts/:id/deliver
- PATCH /api/volunteers/:id/location
- GET /api/analytics

