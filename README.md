# Playto Payout System

A Django-based payout system with idempotency, concurrency control, and Celery-based background processing.

## Features

- **Append-only ledger**: All transactions are immutable credits/debits
- **Concurrency-safe**: Uses PostgreSQL row-level locking (SELECT FOR UPDATE)
- **Idempotency**: UUID-based idempotency keys with 24-hour expiration
- **State machine**: Enforced payout status transitions (pending → processing → completed/failed)
- **Background processing**: Celery workers simulate bank transfers with retry logic
- **React dashboard**: Real-time balance tracking and payout requests

## Architecture

### Backend (Django)
- `backend/payout/models.py`: Merchant, Transaction, Payout models
- `backend/payout/views.py`: REST API endpoints
- `backend/payout/tasks.py`: Celery tasks for payout processing
- `backend/config/celery.py`: Celery configuration with beat schedule

### Frontend (React)
- `frontend/src/App.jsx`: Dashboard with merchant selector, balance cards, and payout forms
- Live polling every 3 seconds for payout status updates

## Quick Start

### Using Docker Compose

```bash
docker-compose up --build
```

This will start:
- PostgreSQL database (port 5432)
- Redis (port 6379)
- Django backend (port 8000)
- Celery worker
- Celery beat scheduler
- React frontend (port 3000)

### Manual Setup

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python seed.py  # Create sample merchants and credits
python manage.py runserver
```

#### Celery (separate terminals)

```bash
# Terminal 1: Worker
cd backend
celery -A config worker -l info

# Terminal 2: Beat scheduler
cd backend
celery -A config beat -l info
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `POST /api/v1/payouts/` - Create payout (requires `Idempotency-Key` header)
- `GET /api/v1/merchants/` - List all merchants
- `GET /api/v1/merchants/<id>/balance/` - Get merchant balance
- `GET /api/v1/merchants/<id>/transactions/` - List transactions (paginated)
- `GET /api/v1/merchants/<id>/payouts/` - List payouts (paginated)

## Running Tests

```bash
cd backend
python manage.py test payout.tests
```

Tests include:
- Concurrency test: Verifies only one of two simultaneous payouts succeeds on insufficient balance
- Idempotency test: Verifies duplicate requests with same key return cached response

## Bank Transfer Simulation

The `simulate_bank_transfer()` function in `tasks.py` simulates bank API responses:
- 70% success
- 20% failure (funds refunded)
- 10% hang (retried by beat scheduler)

Stuck payouts (>30 seconds in 'processing') are automatically retried with exponential backoff, up to 3 attempts.

## Deployment

### Live Deployment
- **Backend API**: https://playto-backend-u2uu.onrender.com
- **Frontend Dashboard**: https://playto-frontend.vercel.app

### Production Architecture

The complete production deployment consists of the following services:

1. **Web Service (Django)**: Handles HTTP API requests
2. **Background Worker (Celery)**: Processes payout tasks asynchronously
3. **Beat Scheduler (Celery)**: Runs periodic tasks for retrying stuck payouts
4. **PostgreSQL Database**: Stores merchants, transactions, and payouts
5. **Redis**: Message broker for Celery task queue

### Current Deployment Status

The live deployment includes:
- ✅ Django backend API (fully functional)
- ✅ React frontend dashboard (fully functional)
- ✅ PostgreSQL database with seeded data
- ✅ CORS configuration for cross-origin requests

The Celery worker and beat services are implemented in the codebase and can be deployed as background workers with a Redis message broker. The `docker-compose.yml` file demonstrates the complete multi-service setup for local development and production deployment.

### Environment Variables

Required environment variables for production:
- `SECRET_KEY`: Django secret key
- `DATABASE_URL`: PostgreSQL connection string
- `CELERY_BROKER_URL`: Redis connection string (for Celery)
- `CELERY_RESULT_BACKEND`: Redis connection string (for Celery results)
