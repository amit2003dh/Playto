# EXPLAINER.md

## The Ledger
```python
credit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(transaction_type='credit'))
)['total'] or 0

debit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(
        transaction_type='debit',
        payout__status__in=['pending', 'processing', 'completed']
    ))
)['total'] or 0

return credit_sum - debit_sum
```

Credits and debits are modelled as separate Transaction rows (not +/- on a balance column) because:
- Append-only ledger is auditable and irreversible
- Balance is always computable from source-of-truth rows
- No UPDATE to a balance column means no update conflicts

## The Lock
```python
with transaction.atomic():
    try:
        merchant = Merchant.objects.select_for_update().get(id=merchant_id)
    except Merchant.DoesNotExist:
        return Response({'error': 'Merchant not found'}, status=404)

    # Calculate available balance at the DB level inside the lock
    credit_sum = merchant.transactions.aggregate(
        total=Sum('amount_paise', filter=Q(transaction_type='credit'))
    )['total'] or 0

    debit_sum = merchant.transactions.aggregate(
        total=Sum('amount_paise', filter=Q(
            transaction_type='debit',
            payout__status__in=['pending', 'processing', 'completed']
        ))
    )['total'] or 0

    available = credit_sum - debit_sum

    if available < amount_paise:
        return Response({
            'error': 'Insufficient balance',
            'available_paise': available,
            'requested_paise': amount_paise,
        }, status=422)
```

Relies on PostgreSQL row-level locking via SELECT FOR UPDATE.
When two concurrent requests hit the same merchant row, one blocks at the lock boundary.
The blocked request re-reads balance after acquiring the lock — by then funds are already held.

## The Idempotency
The unique_together constraint on (merchant, idempotency_key) serves as the idempotency store.
In-flight case: if request A is mid-transaction when request B arrives with the same key,
B will either find the committed Payout (replay response) or hit the unique constraint (500 → retry logic).
The idempotency check happens before the lock, using a 24-hour expiration window.

## The State Machine
```python
ALLOWED_TRANSITIONS = {
    'pending': ['processing'],
    'processing': ['completed', 'failed'],
    'completed': [],
    'failed': [],
}

def transition_to(self, new_status):
    """Enforce state machine. Raise ValueError on illegal transition."""
    allowed = ALLOWED_TRANSITIONS.get(self.status, [])
    if new_status not in allowed:
        raise ValueError(
            f"Illegal transition: {self.status} → {new_status}. "
            f"Allowed from {self.status}: {allowed}"
        )
    self.status = new_status
```

failed → completed is blocked because 'failed' maps to [] in ALLOWED_TRANSITIONS.
The check lives in Payout.transition_to(), called before every status save.

## The AI Audit
One honest example where the initial implementation was wrong:
The initial balance calculation attempted to subtract Sum() expressions inside a single aggregate() call:
```python
result = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(transaction_type='credit'))
    - Sum('amount_paise', filter=Q(transaction_type='debit', payout__status='completed'))
    - Sum('amount_paise', filter=Q(transaction_type='debit', payout__status='processing'))
    - Sum('amount_paise', filter=Q(transaction_type='debit', payout__status='pending'))
)
```
This doesn't work correctly in SQLite (and has portability issues). The subtraction of Sum() expressions inside aggregate() is not valid SQL and returns incorrect results (zeros).

Fixed by doing separate aggregations and subtracting in Python:
```python
credit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(transaction_type='credit'))
)['total'] or 0

debit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(
        transaction_type='debit',
        payout__status__in=['pending', 'processing', 'completed']
    ))
)['total'] or 0

return credit_sum - debit_sum
```
While this uses Python for the final subtraction, it's safe because each aggregation is atomic at the DB level, and the subtraction happens on already-aggregated values that won't change between the two calls when used inside a transaction with proper locking.
