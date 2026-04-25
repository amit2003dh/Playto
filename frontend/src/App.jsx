import { useState, useEffect } from 'react'
import { Wallet, ArrowUpRight, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react'

// Use relative path to leverage Vite proxy
const API_URL = ''

function formatPaise(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function App() {
  const [merchants, setMerchants] = useState([])
  const [selectedMerchant, setSelectedMerchant] = useState(null)
  const [balance, setBalance] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [payouts, setPayouts] = useState([])
  const [payoutForm, setPayoutForm] = useState({ amount: '', bank_account: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Fetch merchants on mount
  useEffect(() => {
    fetchMerchants()
  }, [])

  // Fetch merchant data when selected
  useEffect(() => {
    if (selectedMerchant) {
      fetchBalance()
      fetchTransactions()
      fetchPayouts()
      // Set up polling for payouts
      const interval = setInterval(fetchPayouts, 3000)
      return () => clearInterval(interval)
    }
  }, [selectedMerchant])

  const fetchMerchants = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/merchants/`)
      const data = await res.json()
      setMerchants(data)
      if (data.length > 0) {
        setSelectedMerchant(data[0].id)
      }
    } catch (err) {
      setError('Failed to fetch merchants')
    }
  }

  const fetchBalance = async () => {
    if (!selectedMerchant) return
    try {
      const res = await fetch(`${API_URL}/api/v1/merchants/${selectedMerchant}/balance/`)
      const data = await res.json()
      setBalance(data)
    } catch (err) {
      console.error('Failed to fetch balance')
    }
  }

  const fetchTransactions = async () => {
    if (!selectedMerchant) return
    try {
      const res = await fetch(`${API_URL}/api/v1/merchants/${selectedMerchant}/transactions/`)
      const data = await res.json()
      setTransactions(data.results || [])
    } catch (err) {
      console.error('Failed to fetch transactions')
    }
  }

  const fetchPayouts = async () => {
    if (!selectedMerchant) return
    try {
      const res = await fetch(`${API_URL}/api/v1/merchants/${selectedMerchant}/payouts/`)
      const data = await res.json()
      setPayouts(data.results || [])
    } catch (err) {
      console.error('Failed to fetch payouts')
    }
  }

  const handlePayoutSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    const amountPaise = Math.round(parseFloat(payoutForm.amount) * 100)
    const idempotencyKey = generateUUID()

    try {
      const res = await fetch(`${API_URL}/api/v1/payouts/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          merchant_id: selectedMerchant,
          amount_paise: amountPaise,
          bank_account_id: payoutForm.bank_account,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setSuccess(`Payout of ${formatPaise(amountPaise)} created successfully!`)
        setPayoutForm({ amount: '', bank_account: '' })
        fetchBalance()
        fetchTransactions()
        fetchPayouts()
      } else {
        setError(data.error || 'Failed to create payout')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status) => {
    const badges = {
      pending: <span className="badge pending">Pending</span>,
      processing: <span className="badge processing">Processing</span>,
      completed: <span className="badge completed">Completed</span>,
      failed: <span className="badge failed">Failed</span>,
    }
    return badges[status] || status
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle size={16} className="text-green-600" />
      case 'failed': return <XCircle size={16} className="text-red-600" />
      case 'processing': return <RefreshCw size={16} className="text-blue-600" />
      default: return <Clock size={16} className="text-yellow-600" />
    }
  }

  const selectedMerchantData = merchants.find(m => m.id === selectedMerchant)

  return (
    <div className="container">
      <div className="header">
        <h1>Playto Payout Dashboard</h1>
        <select
          value={selectedMerchant || ''}
          onChange={(e) => setSelectedMerchant(parseInt(e.target.value))}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
        >
          {merchants.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      {balance && (
        <>
          <div className="balance-grid">
            <div className="balance-card available">
              <h3><Wallet size={18} style={{ display: 'inline', marginRight: '8px' }} /> Available Balance</h3>
              <div className="amount">{formatPaise(balance.available_paise)}</div>
            </div>
            <div className="balance-card held">
              <h3><Clock size={18} style={{ display: 'inline', marginRight: '8px' }} /> Held Balance</h3>
              <div className="amount">{formatPaise(balance.held_paise)}</div>
            </div>
            <div className="balance-card total">
              <h3>Total Balance</h3>
              <div className="amount">{formatPaise(balance.total_paise)}</div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Request Payout</h2>
            <form onSubmit={handlePayoutSubmit}>
              <div className="form-group">
                <label>Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={payoutForm.amount}
                  onChange={(e) => setPayoutForm({ ...payoutForm, amount: e.target.value })}
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Bank Account</label>
                <input
                  type="text"
                  value={payoutForm.bank_account}
                  onChange={(e) => setPayoutForm({ ...payoutForm, bank_account: e.target.value })}
                  placeholder={selectedMerchantData?.bank_account || 'Enter bank account'}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Processing...' : <><ArrowUpRight size={16} style={{ display: 'inline', marginRight: '8px' }} /> Create Payout</>}
              </button>
            </form>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Recent Transactions</h2>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(txn => (
                  <tr key={txn.id}>
                    <td className={txn.transaction_type === 'credit' ? 'amount-credit' : 'amount-debit'}>
                      {txn.transaction_type.toUpperCase()}
                    </td>
                    <td className={txn.transaction_type === 'credit' ? 'amount-credit' : 'amount-debit'}>
                      {txn.transaction_type === 'credit' ? '+' : '-'}{formatPaise(txn.amount_paise)}
                    </td>
                    <td>{txn.description}</td>
                    <td>{txn.payout_status ? getStatusBadge(txn.payout_status) : '-'}</td>
                    <td>{new Date(txn.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Payout History</h2>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Bank Account</th>
                  <th>Attempts</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map(payout => (
                  <tr key={payout.id}>
                    <td>#{payout.id}</td>
                    <td>{formatPaise(payout.amount_paise)}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {getStatusIcon(payout.status)}
                        {getStatusBadge(payout.status)}
                      </span>
                    </td>
                    <td>{payout.bank_account_id}</td>
                    <td>{payout.attempts}</td>
                    <td>{new Date(payout.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default App
