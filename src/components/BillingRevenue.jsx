import { useState, useEffect, useMemo } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, Plus, Trash2,
  Receipt, Wallet, PiggyBank, Package, Paperclip, Upload, Banknote
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { orgStore } from '../services/orgStore';
import { catalogService } from '../services/catalogService';
import { netOfTax } from '../services/financeAnalytics';
import { useOrg } from '../context/OrgContext';
import { useNavigate } from 'react-router-dom';
import { receiptService, RECEIPT_ACCEPT } from '../services/receiptService';
import { categoryLabel, countsAsIncome, groupOf, loadFinanceCategories } from '../services/financeCategories';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const chartStyles = () => ({
  tooltip: { background: css('--chart-tooltip-bg'), border: `1px solid ${css('--chart-tooltip-border')}`, borderRadius: 10, fontSize: 12, color: css('--chart-tooltip-text') },
  label: { color: css('--chart-axis-text') },
  axis: { fill: css('--chart-axis-text'), fontSize: 11 },
  grid: css('--chart-grid'),
});

export default function BillingRevenue() {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [finDocs, setFinDocs] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [income, setIncome] = useState([]);

  useEffect(() => {
    if (activeOrg) loadData();
  }, [activeOrg]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await storageService.getAll(activeOrg.id);
      setRecords(data || []);

      // Load financial documents from orgStore
      setFinDocs(documentStore.getAll());

      // Product catalogue. units_sold / revenue / revenue_paid on each row are
      // maintained by trigger from the issued invoices, so this needs no
      // aggregation here — it is already the answer.
      setCatalog(catalogService.getActive());

      // Load expenses from orgStore
      const expList = orgStore.getSectionAsList('expenses');
      expList.sort((a, b) => new Date(b.date) - new Date(a.date));
      setExpenses(expList);

      // Money in that never became an invoice (0038). Revenue on this page used
      // to mean "invoices", which is why cash sales were invisible here.
      await loadFinanceCategories();
      const inList = orgStore.getSectionAsList('income_entries');
      inList.sort((a, b) => new Date(b.date) - new Date(a.date));
      setIncome(inList);
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

    // Include paid invoices from financial documentStore (loaded from Firebase in loadData)
    const paidFinInvoices = finDocs.filter(d => d.type === 'invoice' && d.status === 'paid');
    const finRevenue = paidFinInvoices.reduce((acc, d) => acc + (d.grand_total || d.amount || d.subtotal || 0), 0);

    // Earned, not merely received: funding and refunds are excluded, and so is
    // anything recorded against an invoice, which the invoice already counts.
    const directRevenue = income.filter(countsAsIncome)
      .reduce((acc, e) => acc + netOfTax(e), 0);

    const totalRevenue = oldRevenue + finRevenue + directRevenue;
    const grossProfit = totalRevenue - totalMakingCharges;
    const netProfit = grossProfit - totalExpenses;

    // Grouped by reason rather than by raw category: fifty-odd categories make
    // a pie chart unreadable, and "where does the money go" is a question about
    // product, labour, marketing and overhead — not about forty line items.
    const categoryBreakdown = {};
    expenses.forEach(e => {
      const g = groupOf(e.category);
      categoryBreakdown[g] = (categoryBreakdown[g] || 0) + Number(e.amount);
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
      const mDirect = income
        .filter(countsAsIncome)
        .filter((e) => { const ed = new Date(e.date); return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear(); })
        .reduce((acc, e) => acc + netOfTax(e), 0);
      const mCost = monthInvoices.reduce((acc, r) => acc + (Number(r.data?.makingCharges) || 0), 0);
      const mExp = expenses
        .filter(e => { const ed = new Date(e.date); return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear(); })
        .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
      monthlyCashFlow.push({
        month: d.toLocaleDateString('en-IN', { month: 'short' }),
        revenue: mRev + mFinRev + mDirect,
        makingCharges: mCost,
        expenses: mExp,
        profit: (mRev + mFinRev + mDirect) - mCost - mExp
      });
    }

    // Expense category pie data
    const CATEGORY_COLORS = {
      'Product & delivery': '#3b82f6', 'People & labour': '#10b981',
      'Sales & marketing': '#f59e0b', 'Operations & admin': '#8b5cf6',
      'Assets & capital': '#06b6d4', 'Financing & tax': '#ec4899',
      'Legacy': '#6b7280', 'Other': '#6b7280'
    };
    const expensePieData = Object.entries(categoryBreakdown).map(([name, value]) => ({
      name, value, color: CATEGORY_COLORS[name] || '#6b7280'
    }));

    return { totalRevenue, directRevenue, totalMakingCharges, grossProfit, totalExpenses, netProfit, invoiceCount: invoices.length + paidFinInvoices.length, categoryBreakdown, monthlyCashFlow, expensePieData };
  }, [records, expenses, finDocs, income]);

  // Ranked by what was billed, not what was collected: a product that sold well
  // and has an invoice still outstanding is still the product that sold well.
  const topProducts = useMemo(
    () => catalog
      .filter((p) => Number(p.revenue) > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    [catalog]
  );
  const topProductMax = topProducts[0]?.revenue || 0;

  // Attach a receipt to an expense that was saved without one.
  const handleAttachReceipt = async (exp, file) => {
    if (!file) return;
    try {
      const path = await receiptService.upload(activeOrg.id, 'expenses', file);
      await orgStore.updateItem('expenses', exp.id, { receipt_path: path });
      if (exp.receipt_path) receiptService.remove(exp.receipt_path);
      loadData();
    } catch (err) {
      alert(err.message || 'Could not upload the receipt.');
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      const exp = expenses.find((x) => x.id === id);
      await orgStore.removeItem('expenses', id);
      if (exp?.receipt_path) receiptService.remove(exp.receipt_path);
    } catch (err) {
      alert('Error deleting expense: ' + err.message);
    }
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
            <div className="pro-stat-icon" style={{ color: 'var(--success)' }}>
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: 'var(--success)' }}>₹{stats.totalRevenue.toLocaleString()}</div>
          <div className="pro-stat-label">
            Revenue · {stats.invoiceCount} invoice{stats.invoiceCount !== 1 ? 's' : ''}
            {stats.directRevenue > 0 ? ` + ₹${stats.directRevenue.toLocaleString()} without one` : ''}
          </div>
        </div>

        <div className="pro-stat-card">
          <div className="pro-stat-top">
            <div className="pro-stat-icon" style={{ color: 'var(--text-primary)' }}>
              <Wallet size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: 'var(--text-primary)' }}>₹{stats.totalMakingCharges.toLocaleString()}</div>
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
            <div className="pro-stat-icon">
              <PiggyBank size={20} />
            </div>
          </div>
          <div className="pro-stat-value" style={{ color: stats.netProfit >= 0 ? 'var(--success)' : 'var(--error)' }}>
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
              <TrendingUp size={18} style={{ color: 'var(--success)' }} />
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
              <Wallet size={18} style={{ color: 'var(--text-primary)' }} />
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

      {/* Top products — only worth the space once something has been sold
          against the catalogue. Revenue here is what was BILLED on issued
          invoices; `Collected` is the paid-only subset, which is the same
          definition the revenue card above uses. */}
      {topProducts.length > 0 && (
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Package size={18} style={{ color: 'var(--text-secondary)' }} />
              <h3>Top Products</h3>
            </div>
            <button
              type="button"
              onClick={() => navigate('/products')}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 650, color: 'var(--text-muted)',
                fontFamily: 'inherit',
              }}
            >
              Full breakdown
            </button>
          </div>
          <div className="br-top-products">
            {topProducts.map((p, i) => (
              <div key={p.id} className="br-top-product">
                <span className="br-top-rank">{i + 1}</span>
                <div className="br-top-main">
                  <div className="br-top-name">{p.name}</div>
                  <div className="br-top-meta">
                    {Number(p.units_sold).toLocaleString('en-IN')} sold
                    {p.category ? ` · ${p.category}` : ''}
                  </div>
                  <div className="prod-perf-bar" style={{ maxWidth: '100%' }}>
                    <div style={{ width: topProductMax ? `${Math.max((p.revenue / topProductMax) * 100, 1)}%` : '0%' }} />
                  </div>
                </div>
                <div className="br-top-money">
                  <div>₹{Number(p.revenue).toLocaleString('en-IN')}</div>
                  <span>₹{Number(p.revenue_paid).toLocaleString('en-IN')} collected</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profit/Loss Trend */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <PiggyBank size={18} style={{ color: 'var(--text-secondary)' }} />
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
              <Wallet size={18} style={{ color: 'var(--text-primary)' }} />
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
              <Receipt size={18} style={{ color: 'var(--success)' }} />
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

      {/* Money in that never became an invoice. It sits beside Expenses rather
          than inside the invoice card, because the two are different questions:
          what we billed, and what actually arrived. */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <Banknote size={18} style={{ color: 'var(--success)' }} />
            <h3>Money In (no invoice)</h3>
          </div>
          <button className="billing-add-btn" onClick={() => navigate('/cashbook?new=in')}>
            <Plus size={16} aria-hidden="true" /> Add revenue
          </button>
        </div>
        <div className="billing-expense-list">
          {income.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <Banknote size={40} strokeWidth={1} aria-hidden="true" />
              <p>Nothing recorded outside invoices</p>
              <span>
                Cash sales, retainers, interest, a grant, money you or an investor put in — record it
                here and it reaches revenue, the P&amp;L and the Tax Summary straight away.
              </span>
            </div>
          ) : (
            income.slice(0, 8).map((e) => (
              <div key={e.id} className="billing-expense-item">
                <div className="billing-expense-info">
                  <span className="billing-expense-desc">{e.description}</span>
                  <span className="billing-expense-meta">
                    {categoryLabel(e.category)} · {new Date(e.date).toLocaleDateString()}
                    {countsAsIncome(e) ? '' : ' · cash only, not revenue'}
                  </span>
                </div>
                <div className="billing-expense-right">
                  <span className="billing-expense-amount" style={{ color: 'var(--success)' }}>
                    +₹{Number(e.amount).toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Expenses Section */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <TrendingDown size={18} style={{ color: '#ef4444' }} />
            <h3>Expenses</h3>
          </div>
          <button className="billing-add-btn" onClick={() => navigate('/cashbook?new=out')}>
            <Plus size={16} aria-hidden="true" /> Add expense
          </button>
        </div>

        <div className="billing-expense-list">
          {expenses.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <Wallet size={40} strokeWidth={1} />
              <p>No expenses recorded</p>
              <span>Add one in the Cash Book — it asks what the money was for and works out whether it cuts profit or only cash.</span>
            </div>
          ) : (
            expenses.map(exp => (
              <div key={exp.id} className="billing-expense-item">
                <div className="billing-expense-info">
                  <span className="billing-expense-desc">{exp.description}</span>
                  <span className="billing-expense-meta">
                    {exp.category} · {new Date(exp.date).toLocaleDateString()}
                    {Number(exp.tax_amount) > 0 ? ` · GST ₹${Number(exp.tax_amount).toLocaleString()}` : ''}
                  </span>
                </div>
                <div className="billing-expense-right">
                  <span className="billing-expense-amount">₹{Number(exp.amount).toLocaleString()}</span>
                  {exp.receipt_path ? (
                    <button className="billing-delete-btn" title="View receipt" onClick={() => receiptService.open(exp.receipt_path)} aria-label="View receipt">
                      <Paperclip size={14} />
                    </button>
                  ) : (
                    <label className="billing-delete-btn" title="Attach receipt (PDF or image, max 5 MB)" style={{ cursor: 'pointer' }}>
                      <Upload size={14} />
                      <input type="file" accept={RECEIPT_ACCEPT} hidden
                        onChange={(e) => { handleAttachReceipt(exp, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                  <button className="billing-delete-btn" onClick={() => handleDeleteExpense(exp.id)} aria-label="Delete expense" title="Delete expense">
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
