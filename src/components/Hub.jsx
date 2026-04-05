import React, { useState, useEffect, useMemo } from 'react';
import {
    Users, FileText, PieChart as PieChartIcon, File,
    ChevronRight, Receipt, BarChart3, TrendingUp, Layers,
    Calendar,
} from 'lucide-react';
import {
    AreaChart, Area, PieChart as RechartsPie, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { useOrg } from '../context/OrgContext';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';

const MODULES = [
    { id: 'team',      label: 'Team',          desc: 'Employee registry, offer tracker & bulk imports.',       icon: Users,        defaultPage: 'team-hierarchy', color: '#8b5cf6' },
    { id: 'documents', label: 'Documents',      desc: 'Offer letters, NDAs, MoUs, and certificates.',          icon: FileText,     defaultPage: 'offers',         color: '#10b981' },
    { id: 'finance',   label: 'Finance',        desc: 'Invoices, quotations, proformas & financial status.',   icon: Receipt,      defaultPage: 'finance-status', color: '#f59e0b' },
    { id: 'business',  label: 'Business',       desc: 'Client database and revenue analytics.',                icon: BarChart3,    defaultPage: 'customers',      color: '#d946ef' },
    { id: 'data',      label: 'Records',        desc: 'Past documents and bulk operation history.',            icon: File,         defaultPage: 'records',        color: '#ef4444' },
    { id: 'overall',   label: 'Overview',       desc: 'Comprehensive analytics and business stats.',           icon: PieChartIcon, defaultPage: 'dashboard',      color: '#64748b' },
];

const PIE_COLORS = {
    'Offer Letters': '#fbbf24',
    'Invoices':      '#f97316',
    'Quotations':    '#a855f7',
    'Proformas':     '#6366f1',
};

function useWindowWidth() {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

export default function Hub({ onSelectModule, user, theme }) {
    const isDark = theme === 'dark';
    const { activeOrg } = useOrg();
    const [records, setRecords] = useState([]);
    const [finDocs, setFinDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hoveredMod, setHoveredMod] = useState(null);
    const winW = useWindowWidth();

    const isMobile = winW < 768;
    const isTablet = winW < 1100;

    useEffect(() => {
        if (activeOrg) {
            const loadAll = async () => {
                try {
                    const [data] = await Promise.all([storageService.getAll(activeOrg.id)]);
                    setRecords(data || []);
                    documentStore.setContext(activeOrg.id);
                    await documentStore.init();
                    setFinDocs(documentStore.getAll());
                } catch { /* ignore */ }
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
        const paidFinInvoices = finDocs.filter(d => d.type === 'invoice' && d.status === 'paid');
        const finRevenue = paidFinInvoices.reduce((acc, d) => acc + (d.grand_total || d.amount || d.subtotal || 0), 0);
        const finDocCount = finDocs.length;
        const revenue = oldRevenue + finRevenue;
        const finInvoices = finDocs.filter(d => d.type === 'invoice').length;

        const now = new Date();
        const monthlyRevenue = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthOldRevenue = records
                .filter(r => r.type === 'invoice' && new Date(r.created_at).getMonth() === d.getMonth() && new Date(r.created_at).getFullYear() === d.getFullYear())
                .reduce((acc, r) => acc + (r.data?.totals?.grandTotal || 0), 0);
            const monthFinRevenue = paidFinInvoices
                .filter(d2 => new Date(d2.created_at).getMonth() === d.getMonth() && new Date(d2.created_at).getFullYear() === d.getFullYear())
                .reduce((acc, d2) => acc + (d2.grand_total || d2.amount || d2.subtotal || 0), 0);
            monthlyRevenue.push({ month: d.toLocaleDateString('en-IN', { month: 'short' }), revenue: monthOldRevenue + monthFinRevenue });
        }

        const rawDistribution = [
            { name: 'Offer Letters', value: records.filter(r => r.type === 'offer').length },
            { name: 'Invoices',      value: invoiceRecords.length + finDocs.filter(d => d.type === 'invoice').length },
            { name: 'Quotations',    value: finDocs.filter(d => d.type === 'quotation').length },
            { name: 'Proformas',     value: finDocs.filter(d => d.type === 'proforma').length },
        ].filter(d => d.value > 0);

        const typeDistribution = rawDistribution.length > 0 ? rawDistribution : [
            { name: 'Offer Letters', value: 1 }, { name: 'Invoices', value: 1 },
            { name: 'Quotations', value: 2 },    { name: 'Proformas', value: 2 },
        ];

        return {
            total:    records.length + finDocCount || 6,
            revenue:  revenue || 90,
            invoices: invoiceRecords.length + finInvoices || 1,
            monthlyRevenue: revenue > 0 ? monthlyRevenue : [
                { month: 'Nov', revenue: 25 }, { month: 'Dec', revenue: 40 }, { month: 'Jan', revenue: 50 },
                { month: 'Feb', revenue: 30 }, { month: 'Mar', revenue: 90 }, { month: 'Apr', revenue: 40 },
            ],
            typeDistribution,
        };
    }, [records, finDocs]);

    if (loading) return null;

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = user?.email?.split('@')[0] || 'User';
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    const today = new Date().toLocaleDateString('en-IN', {
        weekday:  isMobile ? undefined : 'long',
        day:      'numeric',
        month:    isMobile ? 'short' : 'long',
        year:     'numeric',
    });

    // ── Theme tokens ──────────────────────────────────────────────────────────
    const cardBg         = isDark ? '#0f0f12' : '#ffffff';
    const cardBorder     = isDark ? 'rgba(255,255,255,0.08)'  : 'rgba(0,0,0,0.08)';
    const cardBorderHov  = isDark ? 'rgba(255,255,255,0.18)'  : 'rgba(0,0,0,0.16)';
    const gridLine       = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
    const tooltipBg      = isDark ? '#111113' : '#ffffff';
    const tooltipText    = isDark ? '#fafafa'  : '#18181b';
    const axisText       = isDark ? 'rgba(255,255,255,0.35)' : '#71717a';
    const gridStroke     = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    const STATS = [
        { label: 'Total Documents',  value: stats.total.toLocaleString(),          icon: FileText,  color: '#6366f1', sub: 'All time' },
        { label: 'Revenue',          value: `₹${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: '#10b981', sub: 'Paid invoices' },
        { label: 'Invoices Issued',  value: stats.invoices.toLocaleString(),        icon: Receipt,   color: '#f59e0b', sub: 'Total issued' },
        { label: 'Active Modules',   value: '6',                                    icon: Layers,    color: '#8b5cf6', sub: 'Full suite' },
    ];

    // ── Layout values ─────────────────────────────────────────────────────────
    const outerPad    = isMobile ? '1.25rem 1rem 4rem'   : isTablet ? '2rem 2rem 4rem'   : '3rem 4rem 5rem';
    const statsGrid   = isMobile ? 'repeat(2, 1fr)'      : 'repeat(4, 1fr)';
    const chartsGrid  = isMobile || isTablet ? '1fr'     : 'minmax(0,1.55fr) minmax(0,1fr)';
    const modulesGrid = isMobile ? 'repeat(2, 1fr)'      : isTablet ? 'repeat(2, 1fr)'    : 'repeat(3, 1fr)';
    const chartH      = isMobile ? 145 : 175;
    const modPad      = isMobile ? '1rem' : '1.5rem';
    const h1Size      = isMobile ? '1.6rem' : 'clamp(1.75rem, 3vw, 2.25rem)';

    return (
        <div style={{
            minHeight: '100vh',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            WebkitFontSmoothing: 'antialiased',
            position: 'relative',
            background: isDark ? '#09090b' : '#f8f9fb',
        }}>
            {/* Grid background */}
            <div style={{
                position: 'fixed', inset: 0,
                backgroundImage: `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px)`,
                backgroundSize: '60px 60px',
                maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 10%, transparent 75%)',
                WebkitMaskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 10%, transparent 75%)',
                pointerEvents: 'none', zIndex: 0,
            }} />

            {/* Top radial glow (dark only) */}
            {isDark && (
                <div style={{
                    position: 'fixed', top: -300, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 900, height: 600,
                    background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.035) 0%, transparent 65%)',
                    pointerEvents: 'none', zIndex: 0,
                }} />
            )}

            {/* ── Page content ──────────────────────────────────────────────── */}
            <div style={{
                position: 'relative', zIndex: 1,
                maxWidth: 1300, margin: '0 auto',
                padding: outerPad,
            }}>

                {/* ── HEADER ─────────────────────────────────────────────────── */}
                <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'flex-start' : 'flex-start',
                    justifyContent: 'space-between',
                    gap: isMobile ? '1rem' : '0',
                    marginBottom: isMobile ? '1.75rem' : '2.75rem',
                }}>
                    <div>
                        {/* Eyebrow badge */}
                        <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                            padding: '0.3rem 0.875rem',
                            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                            border: `1px solid ${cardBorder}`,
                            borderRadius: '999px',
                            fontSize: '0.6rem', fontWeight: 700,
                            color: isDark ? 'rgba(255,255,255,0.4)' : '#71717a',
                            textTransform: 'uppercase', letterSpacing: '0.08em',
                            marginBottom: '0.875rem',
                        }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                            EdgeOS Dashboard
                        </div>

                        <h1 style={{
                            fontSize: h1Size,
                            fontWeight: 800, letterSpacing: '-0.04em',
                            lineHeight: 1.1, margin: '0 0 0.5rem',
                            color: isDark ? '#fafafa' : '#18181b',
                            ...(isDark ? {
                                background: 'linear-gradient(135deg, #ffffff 30%, rgba(255,255,255,0.45) 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            } : {}),
                        }}>
                            {greeting}, {displayName}
                        </h1>
                        <p style={{
                            fontSize: isMobile ? '0.8125rem' : '0.9375rem',
                            color: isDark ? 'rgba(255,255,255,0.35)' : '#71717a',
                            margin: 0, fontWeight: 400,
                        }}>
                            Enterprise overview &amp; analytics
                        </p>
                    </div>

                    {/* Date chip */}
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        padding: '0.45rem 1rem',
                        background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                        border: `1px solid ${cardBorder}`,
                        borderRadius: '999px',
                        fontSize: '0.72rem', fontWeight: 600,
                        color: isDark ? 'rgba(255,255,255,0.4)' : '#71717a',
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap',
                        alignSelf: isMobile ? 'flex-start' : 'flex-start',
                        marginTop: isMobile ? 0 : '0.25rem',
                    }}>
                        <Calendar size={12} style={{ opacity: 0.6 }} />
                        {today}
                    </div>
                </div>

                {/* ── STATS ──────────────────────────────────────────────────── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: statsGrid,
                    gap: isMobile ? '0.75rem' : '1rem',
                    marginBottom: isMobile ? '0.875rem' : '1.25rem',
                }}>
                    {STATS.map((stat, i) => {
                        const Icon = stat.icon;
                        return (
                            <div key={i} style={{
                                background: cardBg,
                                border: `1px solid ${cardBorder}`,
                                borderRadius: isMobile ? '12px' : '14px',
                                padding: isMobile ? '1rem' : '1.25rem 1.375rem',
                                position: 'relative', overflow: 'hidden',
                            }}>
                                {/* Accent line */}
                                <div style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                                    background: `linear-gradient(90deg, ${stat.color}, transparent)`,
                                    opacity: 0.7,
                                }} />

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? '0.625rem' : '0.875rem' }}>
                                    <span style={{
                                        fontSize: '0.6rem', fontWeight: 700,
                                        color: isDark ? 'rgba(255,255,255,0.3)' : '#a1a1aa',
                                        textTransform: 'uppercase', letterSpacing: '0.07em',
                                        lineHeight: 1.3,
                                    }}>
                                        {stat.label}
                                    </span>
                                    <div style={{
                                        width: isMobile ? 26 : 30, height: isMobile ? 26 : 30,
                                        borderRadius: '8px',
                                        background: `${stat.color}18`, border: `1px solid ${stat.color}28`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: stat.color, flexShrink: 0,
                                    }}>
                                        <Icon size={isMobile ? 12 : 14} strokeWidth={2.5} />
                                    </div>
                                </div>

                                <div style={{
                                    fontSize: isMobile ? '1.375rem' : '1.875rem',
                                    fontWeight: 800, letterSpacing: '-0.04em',
                                    color: isDark ? '#fafafa' : '#18181b',
                                    lineHeight: 1, marginBottom: '0.3rem',
                                    // Truncate if number is long on mobile
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {stat.value}
                                </div>
                                <div style={{
                                    fontSize: '0.6rem',
                                    color: isDark ? 'rgba(255,255,255,0.25)' : '#a1a1aa',
                                    fontWeight: 500,
                                }}>
                                    {stat.sub}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── CHARTS ─────────────────────────────────────────────────── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: chartsGrid,
                    gap: isMobile ? '0.75rem' : '1rem',
                    marginBottom: isMobile ? '1.25rem' : '1.5rem',
                }}>
                    {/* Revenue Trend */}
                    <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: isMobile ? '12px' : '14px', padding: isMobile ? '1rem' : '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isMobile ? '1rem' : '1.5rem' }}>
                            <div>
                                <h3 style={{ fontSize: isMobile ? '0.8rem' : '0.875rem', fontWeight: 700, color: isDark ? '#fafafa' : '#18181b', margin: '0 0 0.25rem', letterSpacing: '-0.02em' }}>
                                    Revenue Trend
                                </h3>
                                <p style={{ fontSize: '0.6rem', color: isDark ? 'rgba(255,255,255,0.3)' : '#a1a1aa', margin: 0, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Last 6 months
                                </p>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: isMobile ? '1.125rem' : '1.375rem', fontWeight: 800, letterSpacing: '-0.04em', color: isDark ? '#fafafa' : '#18181b' }}>
                                    ₹{stats.revenue.toLocaleString()}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600, marginTop: '0.125rem' }}>
                                    {stats.invoices} invoice{stats.invoices !== 1 ? 's' : ''}
                                </div>
                            </div>
                        </div>
                        <div style={{ height: chartH }}>
                            <ResponsiveContainer>
                                <AreaChart data={stats.monthlyRevenue} margin={{ top: 5, right: 0, left: isMobile ? -30 : -25, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="hubRevGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%"  stopColor="#10b981" stopOpacity={isDark ? 0.3 : 0.18} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                                    <XAxis dataKey="month" tick={{ fill: axisText, fontSize: isMobile ? 10 : 11 }} axisLine={false} tickLine={false} dy={8} />
                                    <YAxis tick={{ fill: axisText, fontSize: isMobile ? 10 : 11 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{ background: tooltipBg, border: `1px solid ${cardBorder}`, borderRadius: 10, fontSize: 12, color: tooltipText }}
                                        formatter={(v) => [`₹${v.toLocaleString()}`, 'Revenue']}
                                        labelStyle={{ color: isDark ? 'rgba(255,255,255,0.5)' : '#71717a' }}
                                    />
                                    <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#hubRevGrad)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Document Distribution */}
                    <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: isMobile ? '12px' : '14px', padding: isMobile ? '1rem' : '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMobile ? '0.875rem' : '1.125rem' }}>
                            <div>
                                <h3 style={{ fontSize: isMobile ? '0.8rem' : '0.875rem', fontWeight: 700, color: isDark ? '#fafafa' : '#18181b', margin: '0 0 0.25rem', letterSpacing: '-0.02em' }}>
                                    Document Mix
                                </h3>
                                <p style={{ fontSize: '0.6rem', color: isDark ? 'rgba(255,255,255,0.3)' : '#a1a1aa', margin: 0, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    By type
                                </p>
                            </div>
                            <span style={{
                                fontSize: '0.6rem', fontWeight: 700,
                                padding: '0.3rem 0.75rem',
                                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                border: `1px solid ${cardBorder}`,
                                borderRadius: '999px',
                                color: isDark ? 'rgba(255,255,255,0.4)' : '#71717a',
                                letterSpacing: '0.04em',
                            }}>
                                {stats.total} total
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', height: chartH }}>
                            <div style={{ width: isMobile ? '48%' : '52%', height: chartH }}>
                                <ResponsiveContainer>
                                    <RechartsPie>
                                        <Pie
                                            data={stats.typeDistribution}
                                            cx="50%" cy="50%"
                                            innerRadius={isMobile ? 32 : 42}
                                            outerRadius={isMobile ? 55 : 70}
                                            paddingAngle={3}
                                            dataKey="value"
                                            strokeWidth={0}
                                        >
                                            {stats.typeDistribution.map((entry, i) => (
                                                <Cell key={i} fill={PIE_COLORS[entry.name] || '#94a3b8'} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ background: tooltipBg, border: `1px solid ${cardBorder}`, borderRadius: 10, fontSize: 12, color: tooltipText }}
                                        />
                                    </RechartsPie>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: isMobile ? '0.5rem' : '0.625rem', paddingLeft: isMobile ? '0.5rem' : '0.75rem' }}>
                                {stats.typeDistribution.map((d, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: PIE_COLORS[d.name] || '#94a3b8', flexShrink: 0 }} />
                                        <span style={{ fontSize: isMobile ? '0.68rem' : '0.75rem', color: isDark ? 'rgba(255,255,255,0.55)' : '#3f3f46', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {d.name}
                                        </span>
                                        <span style={{ fontSize: isMobile ? '0.68rem' : '0.75rem', color: isDark ? 'rgba(255,255,255,0.3)' : '#a1a1aa', fontWeight: 700, flexShrink: 0 }}>
                                            {d.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── WORKSPACES HEADER ─────────────────────────────────────── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: isMobile ? '0.75rem' : '1rem' }}>
                    <span style={{
                        fontSize: '0.6rem', fontWeight: 700,
                        color: isDark ? 'rgba(255,255,255,0.3)' : '#a1a1aa',
                        textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap',
                    }}>
                        Workspaces
                    </span>
                    <div style={{ flex: 1, height: '1px', background: cardBorder }} />
                    <span style={{
                        fontSize: '0.6rem', fontWeight: 700,
                        color: isDark ? 'rgba(255,255,255,0.25)' : '#a1a1aa',
                        letterSpacing: '0.06em', whiteSpace: 'nowrap',
                    }}>
                        6 modules
                    </span>
                </div>

                {/* ── MODULES GRID ──────────────────────────────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: modulesGrid, gap: isMobile ? '0.75rem' : '1rem' }}>
                    {MODULES.map((mod) => {
                        const Icon = mod.icon;
                        const isHov = hoveredMod === mod.id;
                        return (
                            <div
                                key={mod.id}
                                onClick={() => onSelectModule(mod.id, mod.defaultPage)}
                                onMouseEnter={() => setHoveredMod(mod.id)}
                                onMouseLeave={() => setHoveredMod(null)}
                                style={{
                                    background: isHov ? (isDark ? '#111116' : '#fafafa') : cardBg,
                                    border: `1px solid ${isHov ? cardBorderHov : cardBorder}`,
                                    borderRadius: isMobile ? '12px' : '14px',
                                    padding: modPad,
                                    cursor: 'pointer',
                                    transition: 'all 0.22s cubic-bezier(0.22,1,0.36,1)',
                                    transform: isHov && !isMobile ? 'translateY(-3px)' : 'none',
                                    boxShadow: isHov && !isMobile
                                        ? `0 16px 40px rgba(0,0,0,${isDark ? 0.55 : 0.1}), 0 0 0 1px ${cardBorderHov}`
                                        : 'none',
                                    position: 'relative', overflow: 'hidden',
                                    display: 'flex', flexDirection: 'column',
                                    // Tap highlight on mobile
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                {/* Top gradient accent */}
                                <div style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                                    background: `linear-gradient(90deg, ${mod.color} 0%, ${mod.color}40 60%, transparent 100%)`,
                                    opacity: isHov ? 1 : 0.5,
                                    transition: 'opacity 0.22s ease',
                                }} />

                                {/* Corner glow */}
                                <div style={{
                                    position: 'absolute', top: -50, left: -50,
                                    width: 150, height: 150,
                                    background: `radial-gradient(circle, ${mod.color}12, transparent 65%)`,
                                    opacity: isHov ? 1 : 0,
                                    transition: 'opacity 0.3s ease',
                                    pointerEvents: 'none',
                                }} />

                                {/* Icon + Title */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0.625rem' : '0.875rem', marginBottom: isMobile ? '0.625rem' : '0.875rem' }}>
                                    <div style={{
                                        width: isMobile ? 32 : 38, height: isMobile ? 32 : 38,
                                        borderRadius: '10px',
                                        background: isHov ? `${mod.color}22` : `${mod.color}14`,
                                        border: `1px solid ${isHov ? mod.color + '45' : mod.color + '22'}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: mod.color, flexShrink: 0,
                                        transition: 'all 0.22s ease',
                                    }}>
                                        <Icon size={isMobile ? 15 : 17} strokeWidth={2.2} />
                                    </div>
                                    <h3 style={{
                                        fontSize: isMobile ? '0.8125rem' : '0.9375rem',
                                        fontWeight: 700,
                                        color: isDark ? '#fafafa' : '#18181b',
                                        margin: 0, letterSpacing: '-0.02em',
                                        // Prevent overflow on tiny screens
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {mod.label}
                                    </h3>
                                </div>

                                {/* Description — hidden on very narrow screens */}
                                {!isMobile && (
                                    <p style={{
                                        fontSize: '0.8125rem',
                                        color: isDark ? 'rgba(255,255,255,0.38)' : '#71717a',
                                        lineHeight: 1.65, margin: '0 0 1.25rem', flex: 1,
                                    }}>
                                        {mod.desc}
                                    </p>
                                )}

                                {/* Footer */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    paddingTop: isMobile ? '0.625rem' : '1rem',
                                    marginTop: isMobile ? '0.625rem' : 0,
                                    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                                }}>
                                    <span style={{
                                        fontSize: '0.6rem', fontWeight: 700,
                                        letterSpacing: '0.08em', textTransform: 'uppercase',
                                        color: isHov ? mod.color : (isDark ? 'rgba(255,255,255,0.25)' : '#a1a1aa'),
                                        transition: 'color 0.22s ease',
                                    }}>
                                        Open
                                    </span>
                                    <div style={{
                                        width: 22, height: 22, borderRadius: '7px',
                                        background: isHov ? `${mod.color}20` : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
                                        border: `1px solid ${isHov ? mod.color + '35' : cardBorder}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.22s ease',
                                    }}>
                                        <ChevronRight size={11} color={isHov ? mod.color : (isDark ? 'rgba(255,255,255,0.3)' : '#a1a1aa')} strokeWidth={2.5} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── FOOTER ────────────────────────────────────────────────── */}
                <div style={{
                    marginTop: isMobile ? '2rem' : '3rem',
                    paddingTop: '1.25rem',
                    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <span style={{ fontSize: '0.6rem', color: isDark ? 'rgba(255,255,255,0.2)' : '#a1a1aa', fontWeight: 500 }}>
                        EdgeOS · Enterprise Operating System
                    </span>
                    <span style={{ fontSize: '0.6rem', color: isDark ? 'rgba(255,255,255,0.2)' : '#a1a1aa', fontWeight: 500 }}>
                        {activeOrg?.company_name || activeOrg?.name || 'Workspace'}
                    </span>
                </div>

            </div>
        </div>
    );
}
