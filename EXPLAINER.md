# EXPLAINER.md

## The Ledger
```python
credit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(transaction_type='credit'))
)['total'] or 0

debit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(transaction_type='debit'))
)['total'] or 0

return credit_sum - debit_sum
```

I modeled credits and debits as separate Transaction rows instead of having a balance column that gets updated. Here's why:

- Every transaction is a permanent record - you can always audit the full history
- The balance is just calculated from the transactions, so it's always accurate
- No updating a balance column means no race conditions when multiple requests try to change it at once

I subtract ALL debits (not filtering by payout status) because when a payout fails, the debit transaction stays in the ledger (the money was actually held temporarily) and a refund credit is added. If I only subtracted "successful" debits, the money would be counted twice - once from the original credit and once from the refund.

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
        total=Sum('amount_paise', filter=Q(transaction_type='debit'))
    )['total'] or 0

    available = credit_sum - debit_sum

    if available < amount_paise:
        return Response({
            'error': 'Insufficient balance',
            'available_paise': available,
            'requested_paise': amount_paise,
        }, status=422)
```

This uses PostgreSQL's row-level locking with `SELECT FOR UPDATE`. Here's what happens when two requests come in at the same time trying to spend the same money:

The first request grabs the lock on the merchant row. The second request has to wait at that line. Once the first request finishes (either succeeds or fails), it releases the lock. The second request then gets the lock, re-reads the balance, and sees that the money is already gone (if the first succeeded). This prevents the classic "two people spend the same $100" problem.

## The Idempotency
The system uses a database constraint `unique_together` on (merchant, idempotency_key) to detect duplicate requests. When a request comes in with an idempotency key, I first check if a payout with that key already exists (within 24 hours). If it does, I return the exact same response as the first time.

The tricky case is when the first request is still in progress when the second one arrives. In that case, the second request might either find the already-committed payout (if the first finished just in time) or hit the unique constraint error (if they're truly simultaneous). I handle the constraint error as a 500 that the client can retry.

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

I enforce strict state transitions. A payout can only go from pending → processing → completed/failed. You can't go backwards or jump around. The check is in the `transition_to()` method which gets called before every status change. For example, trying to go from 'failed' to 'completed' will raise a ValueError because 'failed' has an empty list of allowed transitions.

## The AI Audit
Here's a real bug I caught that came from trusting the initial code too much:

The original balance calculation only subtracted debits that had "successful" payout statuses:
```python
debit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(
        transaction_type='debit',
        payout__status__in=['pending', 'processing', 'completed']
    ))
)['total'] or 0
```

This caused a double-money bug. When a payout failed, the debit transaction stayed in the ledger (because the money WAS held temporarily) and a refund credit was added. But since failed debits weren't being subtracted from the balance, the money got counted twice - once from the original credit and once from the refund credit.

I fixed it by subtracting ALL debits regardless of payout status:
```python
debit_sum = self.transactions.aggregate(
    total=Sum('amount_paise', filter=Q(transaction_type='debit'))
)['total'] or 0
```

Now the math works out: credits minus all debits equals the actual available balance. When a payout fails, the debit stays subtracted (the money was held) and the refund credit adds it back to the available balance.
