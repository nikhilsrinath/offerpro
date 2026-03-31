import { useState, useEffect, useMemo } from 'react';
import {
  FileText, Award, FileCode, Briefcase, Receipt,
  DollarSign, TrendingUp, ArrowRight, Activity,
  Building, MapPin, Users, Globe, Clock, Layers, Target,
  ArrowUpRight, BarChart3, Zap, Calendar, PieChart
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const chartStyles = () => ({
  tooltip: { background: css('--chart-tooltip-bg'), border: `1px solid ${css('--chart-tooltip-border')}`, borderRadius: 10, fontSize: 12, color: css('--chart-tooltip-text') },
  label: { color: css('--chart-axis-text') },
  axis: { fill: css('--chart-axis-text'), fontSize: 11 },
  grid: css('--chart-grid'),
});

export default function Dashboard({ onNavigate }) {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [finDocs, setFinDocs] = useState([]);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeOrg) {
      const loadAll = async () => {
        try {
          const [data, emps] = await Promise.all([
            storageService.getAll(activeOrg.id),
            storageService.getEmployees(activeOrg.id)
          ]);
          setRecords(data || []);
          setEmployeeCount((emps || []).length);

          // Load financial documents from Firebase-synced store
          documentStore.setContext(activeOrg.id);
          await documentStore.init();
          setFinDocs(documentStore.getAll());
        } catch {
          // ignore
        }
        setLoading(false);
      };
      loadAll();
    } else {
      setLoading(false);
    }
  }, [activeOrg]);

  const stats = useMemo(() => {
    const invoiceRecords = records.filter(r => r.type === 'invoice');
    const oldRevenue = invoiceRecords.reduce((acc, r) => acc + (r.data?.totals?.grandTotal || 0), 0);
    const makingCharges = invoiceRecords.reduce((acc, r) => acc + (Number(r.data?.makingCharges) || 0), 0);

    // Include paid invoices from financial documentStore (loaded from Firebase in useEffect)
    const paidFinInvoices = finDocs.filter(d => d.type === 'invoice' && d.status === 'paid');
    const finRevenue = paidFinInvoices.reduce((acc, d) => acc + (d.grand_total || d.amount || d.subtotal || 0), 0);
    const finDocCount = finDocs.length;

    const revenue = oldRevenue + finRevenue;
    const grossProfit = revenue - makingCharges;

    const thisMonth = records.filter(r => {
      const d = new Date(r.created_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const finThisMonth = finDocs.filter(d => {
      const dt = new Date(d.created_at);
      const now = new Date();
      return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
    });

    // Monthly revenue data (last 6 months)
    const monthlyRevenue = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthRecords = records.filter(r => {
        const rd = new Date(r.created_at);
        return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
      });
      const monthOldRevenue = monthRecords
        .filter(r => r.type === 'invoice')
        .reduce((acc, r) => acc + (r.data?.totals?.grandTotal || 0), 0);
      const monthFinRevenue = paidFinInvoices
        .filter(d2 => {
          const rd = new Date(d2.created_at);
          return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
        })
        .reduce((acc, d2) => acc + (d2.grand_total || d2.amount || d2.subtotal || 0), 0);
      const monthFinDocs = finDocs.filter(d2 => {
        const rd = new Date(d2.created_at);
        return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
      });
      monthlyRevenue.push({
        month: d.toLocaleDateString('en-IN', { month: 'short' }),
        revenue: monthOldRevenue + monthFinRevenue,
        documents: monthRecords.length + monthFinDocs.length
      });
    }

    // Document type distribution
    const finQuotations = finDocs.filter(d => d.type === 'quotation').length;
    const finProformas = finDocs.filter(d => d.type === 'proforma').length;
    const finInvoices = finDocs.filter(d => d.type === 'invoice').length;
    const typeDistribution = [
      { name: 'Offer Letters', value: records.filter(r => r.type === 'offer').length, color: '#3b82f6' },
      { name: 'Certificates', value: records.filter(r => r.type === 'certificate').length, color: '#f59e0b' },
      { name: 'NDAs', value: records.filter(r => r.type === 'nda').length, color: '#10b981' },
      { name: 'MoUs', value: records.filter(r => r.type === 'mou').length, color: '#14b8a6' },
      { name: 'Invoices', value: records.filter(r => r.type === 'invoice').length + finInvoices, color: '#8b5cf6' },
      { name: 'Quotations', value: finQuotations, color: '#f97316' },
      { name: 'Proformas', value: finProformas, color: '#06b6d4' },
    ].filter(d => d.value > 0);

    return {
      total: records.length + finDocCount,
      offers: records.filter(r => r.type === 'offer').length,
      certificates: records.filter(r => r.type === 'certificate').length,
      ndas: records.filter(r => r.type === 'nda').length,
      mous: records.filter(r => r.type === 'mou').length,
      invoices: records.filter(r => r.type === 'invoice').length + finInvoices,
      revenue,
      makingCharges,
      grossProfit,
      thisMonth: thisMonth.length + finThisMonth.length,
      monthlyRevenue,
      typeDistribution
    };
  }, [records, finDocs]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const orgName = activeOrg?.owner_full_name || activeOrg?.company_name || user?.displayName || 'there';

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const STAT_CARDS = [
    { label: 'Total Documents', value: stats.total, icon: FileText, color: '#3b82f6', bg: '#3b82f612', nav: 'records' },
    { label: 'Team Members', value: employeeCount, icon: Users, color: '#8b5cf6', bg: '#8b5cf612', nav: 'employees' },
    { label: 'Revenue Generated', value: `₹${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: '#10b981', bg: '#10b98112', nav: 'revenue' },
    { label: 'Invoices Issued', value: stats.invoices, icon: Receipt, color: '#f59e0b', bg: '#f59e0b12', nav: 'invoices' },
  ];

  const QUICK_ACTIONS = [
    { id: 'employees', label: 'Employees', desc: 'Manage your team', icon: Users, color: '#8b5cf6' },
    { id: 'offers', label: 'Offer Letter', desc: 'Generate employment offers', icon: Briefcase, color: '#3b82f6' },
    { id: 'certificates', label: 'Certificate', desc: 'Issue achievement certs', icon: Award, color: '#f59e0b' },
    { id: 'ndas', label: 'NDA', desc: 'Draft confidentiality agreements', icon: FileCode, color: '#10b981' },
    { id: 'mous', label: 'MoU', desc: 'Establish partnerships', icon: FileCode, color: '#14b8a6' },
    { id: 'invoices', label: 'Invoice', desc: 'Create GST invoices', icon: Receipt, color: '#8b5cf6' },
    { id: 'revenue', label: 'Revenue', desc: 'Track billing & P&L', icon: DollarSign, color: '#ec4899' },
    { id: 'planner', label: 'Planner', desc: 'Manage products & tasks', icon: Layers, color: '#06b6d4' },
  ];

  const TYPE_COLORS = {
    offer: '#3b82f6', certificate: '#f59e0b', nda: '#10b981', mou: '#14b8a6', invoice: '#8b5cf6'
  };

  const TYPE_ICONS = {
    offer: Briefcase, certificate: Award, nda: FileCode, mou: FileCode, invoice: Receipt
  };

  return (
    <div className="pro-dashboard">
      {/* Welcome Banner */}
      <div className="pro-welcome">
        <div className="pro-welcome-content">
          <div>
            <h1 className="pro-welcome-title">{greeting()}, {orgName.split(' ')[0]}</h1>
            <p className="pro-welcome-sub">
              {activeOrg?.company_name && <span>{activeOrg.company_name}</span>}
              {stats.thisMonth > 0 && (
                <span className="pro-welcome-badge">
                  <Zap size={12} /> {stats.thisMonth} document{stats.thisMonth !== 1 ? 's' : ''} this month
                </span>
              )}
            </p>
          </div>
          <div className="pro-welcome-date">
            <Calendar size={14} />
            <span>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="pro-stats-grid">
        {STAT_CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="pro-stat-card" onClick={() => onNavigate(card.nav)}>
              <div className="pro-stat-top">
                <div className="pro-stat-icon" style={{ background: card.bg, color: card.color }}>
                  <Icon size={20} />
                </div>
                <ArrowUpRight size={16} className="pro-stat-arrow" />
              </div>
              <div className="pro-stat-value">{card.value}</div>
              <div className="pro-stat-label">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* Charts Row: Revenue Trend + Document Distribution */}
      <div className="pro-two-col">
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <BarChart3 size={18} style={{ color: '#10b981' }} />
              <h3>Revenue Trend</h3>
            </div>
            <button className="pro-link-btn" onClick={() => onNavigate('revenue')}>
              View Details <ArrowRight size={14} />
            </button>
          </div>
          <div className="pro-revenue-block">
            <div className="pro-revenue-amount">₹{stats.revenue.toLocaleString()}</div>
            <div className="pro-revenue-meta">{stats.invoices} invoice{stats.invoices !== 1 ? 's' : ''} issued</div>
          </div>
          <div style={{ width: '100%', height: 220, marginTop: '0.5rem' }}>
            <ResponsiveContainer>
              <AreaChart data={stats.monthlyRevenue} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartStyles().grid} />
                <XAxis dataKey="month" tick={chartStyles().axis} axisLine={false} tickLine={false} />
                <YAxis tick={chartStyles().axis} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip
                  contentStyle={chartStyles().tooltip}
                  formatter={(v) => [`₹${v.toLocaleString()}`, 'Revenue']}
                  labelStyle={chartStyles().label}
                />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <PieChart size={18} style={{ color: '#8b5cf6' }} />
              <h3>Document Distribution</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{stats.total} total</span>
          </div>
          {stats.typeDistribution.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <FileText size={36} strokeWidth={1} />
              <p>No documents yet</p>
              <span>Create documents to see distribution</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '55%', height: 220 }}>
                <ResponsiveContainer>
                  <RechartsPie>
                    <Pie data={stats.typeDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" strokeWidth={0}>
                      {stats.typeDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={chartStyles().tooltip}
                      formatter={(v, name) => [v, name]}
                    />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
                {stats.typeDistribution.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', flex: 1 }}>{d.name}</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Documents Bar Chart + Activity */}
      <div className="pro-two-col">
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Calendar size={18} style={{ color: '#3b82f6' }} />
              <h3>Monthly Documents</h3>
            </div>
          </div>
          <div style={{ width: '100%', height: 220, marginTop: '0.5rem' }}>
            <ResponsiveContainer>
              <BarChart data={stats.monthlyRevenue} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartStyles().grid} />
                <XAxis dataKey="month" tick={chartStyles().axis} axisLine={false} tickLine={false} />
                <YAxis tick={chartStyles().axis} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={chartStyles().tooltip}
                  formatter={(v) => [v, 'Documents']}
                  labelStyle={chartStyles().label}
                />
                <Bar dataKey="documents" fill="url(#barGrad)" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Clock size={18} style={{ color: '#8b5cf6' }} />
              <h3>Recent Activity</h3>
            </div>
            <button className="pro-link-btn" onClick={() => onNavigate('records')}>
              All Records <ArrowRight size={14} />
            </button>
          </div>
          <div className="pro-activity-list">
            {records.length === 0 ? (
              <div className="pro-empty">
                <Activity size={36} strokeWidth={1} />
                <p>No activity yet</p>
                <span>Start by creating your first document</span>
              </div>
            ) : (
              records.slice(0, 5).map((r, i) => {
                const Icon = TYPE_ICONS[r.type] || FileText;
                return (
                  <div key={r.id || i} className="pro-activity-item">
                    <div className="pro-activity-icon" style={{ background: `${TYPE_COLORS[r.type]}12`, color: TYPE_COLORS[r.type] }}>
                      <Icon size={14} />
                    </div>
                    <div className="pro-activity-info">
                      <span className="pro-activity-title">{r.title}</span>
                      <span className="pro-activity-meta">{r.type} · {new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.type === 'invoice' && r.data?.totals?.grandTotal && (
                      <span className="pro-activity-amount">₹{r.data.totals.grandTotal.toLocaleString()}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="pro-section">
        <h3 className="pro-section-heading">Quick Actions</h3>
        <div className="pro-actions-grid">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button key={action.id} className="pro-action-card" onClick={() => onNavigate(action.id)}>
                <div className="pro-action-icon" style={{ background: `${action.color}12`, color: action.color }}>
                  <Icon size={20} />
                </div>
                <div className="pro-action-text">
                  <span className="pro-action-label">{action.label}</span>
                  <span className="pro-action-desc">{action.desc}</span>
                </div>
                <ArrowRight size={16} className="pro-action-arrow" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Org Info */}
      {activeOrg && (
        <div className="pro-section">
          <h3 className="pro-section-heading">Organization</h3>
          <div className="pro-org-card">
            <div className="pro-org-grid">
              {[
                { icon: Building, label: 'Company', value: activeOrg.company_name },
                { icon: Globe, label: 'Industry', value: Array.isArray(activeOrg.industry) ? activeOrg.industry.join(', ') : activeOrg.industry },
                { icon: MapPin, label: 'Location', value: [activeOrg.city, activeOrg.country].filter(Boolean).join(', ') },
                { icon: Users, label: 'Team Size', value: activeOrg.company_size },
              ].filter(item => item.value).map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="pro-org-item">
                    <Icon size={16} />
                    <div>
                      <span className="pro-org-label">{item.label}</span>
                      <span className="pro-org-value">{item.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
