# Playto Payout System

This is a payout system I built for the Playto challenge. It handles merchant balances, payout requests, and tracks payout status through different states. The key things it gets right are concurrency (two people can't spend the same money), idempotency (retrying a request doesn't create duplicate payouts), and data integrity (the ledger always balances).

## What it does

- **Ledger**: Every transaction is recorded as a credit or debit - no updating balance columns
- **Concurrency**: Uses PostgreSQL row-level locking so simultaneous requests don't mess up the balance
- **Idempotency**: You can retry requests with the same key without creating duplicates
- **State machine**: Payouts follow a strict path: pending → processing → completed/failed
- **Background jobs**: Celery workers process payouts asynchronously with retry logic
- **Dashboard**: React frontend shows balances and lets you request payouts

## How it's structured

### Backend (Django)
- `backend/payout/models.py`: The data models for merchants, transactions, and payouts
- `backend/payout/views.py`: The API endpoints that the frontend calls
- `backend/payout/tasks.py`: Background jobs that process payouts
- `backend/config/celery.py`: Celery setup and the beat scheduler for retries

### Frontend (React)
- `frontend/src/App.jsx`: The main dashboard where you see balances and request payouts
- It polls the backend every 3 seconds to update payout status in real-time

## Running it locally

### Easiest way - Docker Compose

```bash
docker-compose up --build
```

This spins up everything you need:
- PostgreSQL database
- Redis for the task queue
- Django backend API
- Celery worker (processes payouts)
- Celery beat scheduler (retries stuck payouts)
- React frontend

### Manual setup (if you prefer)

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python seed.py  # This creates some sample merchants with credits
python manage.py runserver
```

#### Celery (you'll need two terminals for this)

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

## API endpoints

- `POST /api/v1/payouts/` - Create a payout (needs an `Idempotency-Key` header)
- `GET /api/v1/merchants/` - List all merchants
- `GET /api/v1/merchants/<id>/balance/` - Get a merchant's balance
- `GET /api/v1/merchants/<id>/transactions/` - List transactions (paginated)
- `GET /api/v1/merchants/<id>/payouts/` - List payouts (paginated)

## Tests

```bash
cd backend
python manage.py test payout.tests
```

I wrote two tests that cover the important stuff:
- **Concurrency test**: Two requests try to spend the same money at the same time - only one should succeed
- **Idempotency test**: Sending the same request twice with the same key should return the same response, not create duplicates

## How the bank simulation works

The `simulate_bank_transfer()` function in `tasks.py` pretends to call a bank API:
- 70% of the time it succeeds
- 20% of the time it fails (and the money gets refunded)
- 10% of the time it hangs (the payout stays in "processing" and gets retried)

If a payout is stuck in "processing" for more than 30 seconds, the beat scheduler picks it up and retries it. It tries up to 3 times with exponential backoff before giving up and marking it as failed.

## Deployment

### Live version
- **Backend API**: https://playto-backend-u2uu.onrender.com
- **Frontend Dashboard**: https://playto-frontend.vercel.app

### What's deployed in production

The live setup has all the pieces running:

1. **Django web service** (on Render) - Handles the API requests
2. **Celery worker** (on Railway) - Processes payout tasks in the background
3. **Celery beat scheduler** (on Render) - Runs the retry logic for stuck payouts
4. **PostgreSQL database** (on Render) - Stores all the data
5. **Redis** (Upstash) - Message broker for the task queue

All of this is on free tiers to keep costs down.

### Environment variables you'll need

For production, you need to set these:
- `SECRET_KEY` - Django's secret key
- `DATABASE_URL` - PostgreSQL connection string
- `CELERY_BROKER_URL` - Redis connection for Celery
- `CELERY_RESULT_BACKEND` - Redis connection for Celery results
