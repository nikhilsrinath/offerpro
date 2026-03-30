import { useState, useEffect, useMemo } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, Plus, Trash2,
  Receipt, Wallet, PiggyBank
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { ref, push, set, get, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { useOrg } from '../context/OrgContext';

const EXPENSE_CATEGORIES = ['Operations', 'Marketing', 'Salaries', 'Tools & Software', 'Office', 'Travel', 'Other'];

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const chartStyles = () => ({
  tooltip: { background: css('--chart-tooltip-bg'), border: `1px solid ${css('--chart-tooltip-border')}`, borderRadius: 10, fontSize: 12, color: css('--chart-tooltip-text') },
  label: { color: css('--chart-axis-text') },
  axis: { fill: css('--chart-axis-text'), fontSize: 11 },
  grid: css('--chart-grid'),
});

export default function BillingRevenue() {
  const { activeOrg } = useOrg();
  const [records, setRecords] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpense, setNewExpense] = useState({
    description: '',
    amount: '',
    category: 'Operations',
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (activeOrg) loadData();
  }, [activeOrg]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await storageService.getAll(activeOrg.id);
      setRecords(data || []);

      const expRef = ref(db, `expenses/${activeOrg.id}`);
      const snap = await get(expRef);
      if (snap.exists()) {
        const expList = [];
        snap.forEach(child => expList.push({ id: child.key, ...child.val() }));
        expList.sort((a, b) => new Date(b.date) - new Date(a.date));
        setExpenses(expList);
      } else {
        setExpenses([]);
      }
    } catch (err) {
      console.error("Error loading billing data:", err);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const invoices = records.filter(r => r.type === 'invoice');
    const oldRevenue = invoices.reduce((acc, r) => acc + (r.data?.totals?.grandTotal || 0), 0);
    const totalMakingCharges = invoices.reduce((acc, r) => acc + (Number(r.data?.makingCharges) || 0), 0);
    const totalExpenses = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

    // Include paid invoices from financial documentStore
    documentStore.init();
    const finDocs = documentStore.getAll();
    const paidFinInvoices = finDocs.filter(d => d.type === 'invoice' && d.status === 'paid');
    const finRevenue = paidFinInvoices.reduce((acc, d) => acc + (d.grand_total || d.amount || d.subtotal || 0), 0);

    const totalRevenue = oldRevenue + finRevenue;
    const grossProfit = totalRevenue - totalMakingCharges;
    const netProfit = grossProfit - totalExpenses;

    const categoryBreakdown = {};
    expenses.forEach(e => {
      categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + Number(e.amount);
    });

    // Monthly cash flow data (last 6 months)
    const now = new Date();
    const monthlyCashFlow = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthInvoices = invoices.filter(r => { const rd = new Date(r.created_at); return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear(); });
      const mRev = monthInvoices.reduce((acc, r) => acc + (r.data?.totals?.grandTotal || 0), 0);
      const mFinRev = paidFinInvoices
        .filter(fd => { const rd = new Date(fd.created_at); return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear(); })
        .reduce((acc, fd) => acc + (fd.grand_total || fd.amount || fd.subtotal || 0), 0);
      const mCost = monthInvoices.reduce((acc, r) => acc + (Number(r.data?.makingCharges) || 0), 0);
      const mExp = expenses
        .filter(e => { const ed = new Date(e.date); return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear(); })
        .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
      monthlyCashFlow.push({
        month: d.toLocaleDateString('en-IN', { month: 'short' }),
        revenue: mRev + mFinRev,
        makingCharges: mCost,
        expenses: mExp,
        profit: (mRev + mFinRev) - mCost - mExp
      });
    }

    // Expense category pie data
    const CATEGORY_COLORS = {
      'Operations': '#3b82f6', 'Marketing': '#f59e0b', 'Salaries': '#10b981',
      'Tools & Software': '#8b5cf6', 'Office': '#ec4899', 'Travel': '#06b6d4', 'Other': '#6b7280'
    };
    const expensePieData = Object.entries(categoryBreakdown).map(([name, value]) => ({
      name, value, color: CATEGORY_COLORS[name] || '#6b7280'
    }));

    return { totalRevenue, totalMakingCharges, grossProfit, totalExpenses, netProfit, invoiceCount: invoices.length + paidFinInvoices.length, categoryBreakdown, monthlyCashFlow, expensePieData };
  }, [records, expenses]);

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!newExpense.description || !newExpense.amount) return;

    const expRef = push(ref(db, `expenses/${activeOrg.id}`));
    await set(expRef, {
      ...newExpense,
      amount: Number(newExpense.amount),
      created_at: new Date().toISOString()
    });

    setNewExpense({ description: '', amount: '', category: 'Operations', date: new Date().toISOString().split('T')[0] });
    setShowAddExpense(false);
    loadData();
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await remove(ref(db, `expenses/${activeOrg.id}/${id}`));
    loadData();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading financial data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="finance-page">
      {/* Summary Cards */}
      <div className="pro-stats-grid">
        <div className="pro-stat-card">
          <div className="pro-stat-top">
            <div className="pro-stat-icon" style={{ background: '#10b98112', color: '#10b981' }}>
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: '#10b981' }}>₹{stats.totalRevenue.toLocaleString()}</div>
          <div className="pro-stat-label">Revenue · {stats.invoiceCount} invoice{stats.invoiceCount !== 1 ? 's' : ''}</div>
        </div>

        <div className="pro-stat-card">
          <div className="pro-stat-top">
            <div className="pro-stat-icon" style={{ background: '#f59e0b12', color: '#f59e0b' }}>
              <Wallet size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: '#f59e0b' }}>₹{stats.totalMakingCharges.toLocaleString()}</div>
          <div className="pro-stat-label">Making Charges · {stats.totalRevenue > 0 ? `${((stats.totalMakingCharges / stats.totalRevenue) * 100).toFixed(0)}% of revenue` : 'No data'}</div>
        </div>

        <div className="pro-stat-card">
          <div className="pro-stat-top">
            <div className="pro-stat-icon" style={{ background: '#ef444412', color: '#ef4444' }}>
              <TrendingDown size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: '#ef4444' }}>₹{stats.totalExpenses.toLocaleString()}</div>
          <div className="pro-stat-label">Expenses · {expenses.length} entries</div>
        </div>

        <div className="pro-stat-card">
          <div className="pro-stat-top">
            <div className="pro-stat-icon" style={{
              background: stats.netProfit >= 0 ? '#3b82f612' : '#ef444412',
              color: stats.netProfit >= 0 ? '#3b82f6' : '#ef4444'
            }}>
              <PiggyBank size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: stats.netProfit >= 0 ? '#3b82f6' : '#ef4444' }}>
            {stats.netProfit >= 0 ? '+' : ''}₹{stats.netProfit.toLocaleString()}
          </div>
          <div className="pro-stat-label">
            Net {stats.netProfit >= 0 ? 'Profit' : 'Loss'} · {stats.totalRevenue > 0 ? `${((stats.netProfit / stats.totalRevenue) * 100).toFixed(1)}% margin` : 'No revenue yet'}
          </div>
        </div>
      </div>

      {/* Charts Row: Revenue vs Expenses + Expense Pie */}
      <div className="pro-two-col">
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <TrendingUp size={18} style={{ color: '#10b981' }} />
              <h3>Revenue vs Expenses</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Last 6 months</span>
          </div>
          <div style={{ width: '100%', height: 260, marginTop: '0.5rem' }}>
            <ResponsiveContainer>
              <BarChart data={stats.monthlyCashFlow} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartStyles().grid} />
                <XAxis dataKey="month" tick={chartStyles().axis} axisLine={false} tickLine={false} />
                <YAxis tick={chartStyles().axis} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip
                  contentStyle={chartStyles().tooltip}
                  formatter={(v, name) => [`₹${v.toLocaleString()}`, name === 'revenue' ? 'Revenue' : 'Expenses']}
                  labelStyle={chartStyles().label}
                />
                <Legend
                  iconType="circle" iconSize={8}
                  wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}
                  formatter={(value) => value === 'revenue' ? 'Revenue' : 'Expenses'}
                />
                <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Wallet size={18} style={{ color: '#f59e0b' }} />
              <h3>Expense Categories</h3>
            </div>
          </div>
          {stats.expensePieData.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <Receipt size={36} strokeWidth={1} />
              <p>No expenses recorded</p>
              <span>Add expenses to see breakdown</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '55%', height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={stats.expensePieData} cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {stats.expensePieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={chartStyles().tooltip}
                      formatter={(v, name) => [`₹${v.toLocaleString()}`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', flex: 1 }}>
                {stats.expensePieData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', flex: 1 }}>{d.name}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>₹{d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profit/Loss Trend */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <PiggyBank size={18} style={{ color: '#3b82f6' }} />
            <h3>Profit & Loss Trend</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Monthly net</span>
        </div>
        <div style={{ width: '100%', height: 220, marginTop: '0.5rem' }}>
          <ResponsiveContainer>
            <AreaChart data={stats.monthlyCashFlow} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartStyles().grid} />
              <XAxis dataKey="month" tick={chartStyles().axis} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyles().axis} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v < -1000 ? `${(v/1000).toFixed(0)}k` : v} />
              <Tooltip
                contentStyle={chartStyles().tooltip}
                formatter={(v) => [`₹${v.toLocaleString()}`, 'Net Profit']}
                labelStyle={chartStyles().label}
              />
              <Area type="monotone" dataKey="profit" stroke="#3b82f6" strokeWidth={2.5} fill="url(#profitGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two Column: Expense Breakdown + Invoice Revenue */}
      <div className="pro-two-col">
        {/* Expense Breakdown */}
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Wallet size={18} style={{ color: '#f59e0b' }} />
              <h3>Expense Breakdown</h3>
            </div>
          </div>
          {Object.keys(stats.categoryBreakdown).length === 0 ? (
            <div className="pro-empty">
              <Receipt size={32} strokeWidth={1} />
              <p>No expenses recorded yet</p>
            </div>
          ) : (
            <div className="billing-breakdown">
              {Object.entries(stats.categoryBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => (
                  <div key={cat} className="billing-breakdown-item">
                    <div className="billing-breakdown-info">
                      <span className="billing-breakdown-cat">{cat}</span>
                      <span className="billing-breakdown-amount">₹{amount.toLocaleString()}</span>
                    </div>
                    <div className="billing-breakdown-bar">
                      <div className="billing-breakdown-fill" style={{ width: `${(amount / stats.totalExpenses) * 100}%` }} />
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>

        {/* Invoice Revenue */}
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Receipt size={18} style={{ color: '#10b981' }} />
              <h3>Invoice Revenue</h3>
            </div>
          </div>
          <div className="billing-invoice-list">
            {records.filter(r => r.type === 'invoice').length === 0 ? (
              <div className="pro-empty">
                <DollarSign size={32} strokeWidth={1} />
                <p>No invoices issued yet</p>
              </div>
            ) : (
              records.filter(r => r.type === 'invoice').slice(0, 8).map((r, i) => {
                const revenue = r.data?.totals?.grandTotal || 0;
                const cost = Number(r.data?.makingCharges) || 0;
                const profit = revenue - cost;
                return (
                  <div key={r.id || i} className="billing-invoice-item">
                    <div className="billing-invoice-info">
                      <span className="billing-invoice-title">{r.title}</span>
                      <span className="billing-invoice-date">{new Date(r.created_at).toLocaleDateString()}{cost > 0 ? ` · Cost: ₹${cost.toLocaleString()}` : ''}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="billing-invoice-amount">₹{revenue.toLocaleString()}</span>
                      {cost > 0 && (
                        <div style={{ fontSize: '0.6875rem', color: profit >= 0 ? '#10b981' : '#ef4444', fontWeight: 600, marginTop: '0.125rem' }}>
                          {profit >= 0 ? '+' : ''}₹{profit.toLocaleString()} profit
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Expenses Section */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <TrendingDown size={18} style={{ color: '#ef4444' }} />
            <h3>Expenses</h3>
          </div>
          <button className="billing-add-btn" onClick={() => setShowAddExpense(!showAddExpense)}>
            <Plus size={16} /> Add Expense
          </button>
        </div>

        {showAddExpense && (
          <form className="billing-expense-form" onSubmit={handleAddExpense}>
            <input type="text" placeholder="Description" value={newExpense.description}
              onChange={e => setNewExpense({ ...newExpense, description: e.target.value })} required className="pro-input" />
            <input type="number" placeholder="Amount (₹)" value={newExpense.amount}
              onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} required className="pro-input" />
            <select value={newExpense.category}
              onChange={e => setNewExpense({ ...newExpense, category: e.target.value })} className="pro-input">
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="date" value={newExpense.date}
              onChange={e => setNewExpense({ ...newExpense, date: e.target.value })} className="pro-input" />
            <div className="billing-expense-form-actions">
              <button type="submit" className="billing-save-btn">Save</button>
              <button type="button" className="billing-cancel-btn" onClick={() => setShowAddExpense(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="billing-expense-list">
          {expenses.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <Wallet size={40} strokeWidth={1} />
              <p>No expenses recorded</p>
              <span>Click "Add Expense" to start tracking</span>
            </div>
          ) : (
            expenses.map(exp => (
              <div key={exp.id} className="billing-expense-item">
                <div className="billing-expense-info">
                  <span className="billing-expense-desc">{exp.description}</span>
                  <span className="billing-expense-meta">{exp.category} · {new Date(exp.date).toLocaleDateString()}</span>
                </div>
                <div className="billing-expense-right">
                  <span className="billing-expense-amount">₹{Number(exp.amount).toLocaleString()}</span>
                  <button className="billing-delete-btn" onClick={() => handleDeleteExpense(exp.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
