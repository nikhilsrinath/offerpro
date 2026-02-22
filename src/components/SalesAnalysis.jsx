import { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  FileText, 
  Award, 
  FileCode, 
  Activity, 
  ArrowUpRight, 
  Clock, 
  Briefcase 
} from 'lucide-react';
import { storageService } from '../services/storageService';
import { useOrg } from '../context/OrgContext';

const StatCard = ({ title, value, icon: Icon, trend, trendValue, color }) => (
  <div className="card bento-card" style={{ padding: '2rem', minHeight: 'auto', background: 'rgba(10, 10, 10, 0.5)', backdropFilter: 'blur(20px)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
      <div style={{ 
        width: '48px', 
        height: '48px', 
        borderRadius: '12px', 
        background: `${color}15`, 
        color: color, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <Icon size={24} />
      </div>
      {trend && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.25rem', 
          fontSize: '0.875rem', 
          fontWeight: 700, 
          color: trend === 'up' ? '#10b981' : '#ef4444',
          background: trend === 'up' ? '#10b98110' : '#ef444410',
          padding: '0.25rem 0.75rem',
          borderRadius: '99px'
        }}>
          {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {trendValue}
        </div>
      )}
    </div>
    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
      {title}
    </div>
    <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
      {value}
    </div>
  </div>
);

const ProgressBar = ({ label, current, total, color }) => {
  const percentage = Math.min((current / total) * 100, 100);
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
        <span style={{ color: '#fff', fontWeight: 700 }}>{current} / {total}</span>
      </div>
      <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ 
          width: `${percentage}%`, 
          height: '100%', 
          background: `linear-gradient(90deg, ${color} 0%, white 100%)`, 
          borderRadius: '4px',
          boxShadow: `0 0 20px ${color}60`,
          transition: 'width 1.5s cubic-bezier(0.16, 1, 0.3, 1)'
        }} />
      </div>
    </div>
  );
};

export default function SalesAnalysis() {
  const { activeOrg } = useOrg();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!activeOrg) return;
      try {
        const { data } = await storageService.getRecords(activeOrg.id);
        setRecords(data || []);
      } catch (err) {
        console.error("Error loading analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [activeOrg]);

  const stats = useMemo(() => {
    const totalRevenue = records
      .filter(r => r.type === 'invoice')
      .reduce((acc, r) => acc + (r.data?.totals?.grandTotal || 0), 0);

    const counts = {
      offer: records.filter(r => r.type === 'offer').length,
      certificate: records.filter(r => r.type === 'certificate').length,
      mou: records.filter(r => r.type === 'mou').length,
      invoice: records.filter(r => r.type === 'invoice').length
    };

    return { totalRevenue, counts };
  }, [records]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10rem' }}>
        <div className="badge-cinematic">Analyzing Intelligence...</div>
      </div>
    );
  }

  return (
    <div className="animate-in" style={{ padding: '2rem 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
        <StatCard 
          title="Total Revenue" 
          value={`₹${stats.totalRevenue.toLocaleString()}`} 
          icon={DollarSign} 
          trend="up" 
          trendValue="+12.4%" 
          color="var(--accent)"
        />
        <StatCard 
          title="Active Contracts" 
          value={stats.counts.mou} 
          icon={FileCode} 
          trend="up" 
          trendValue="+2" 
          color="#10b981"
        />
        <StatCard 
          title="Invoices Issued" 
          value={stats.counts.invoice} 
          icon={FileText} 
          color="#f59e0b"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div className="card bento-card" style={{ padding: '3rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2.5rem' }}>
            <Activity size={20} color="var(--accent)" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Document Velocity</h3>
          </div>
          
          <ProgressBar label="Offer Letters" current={stats.counts.offer} total={50} color="#2563eb" />
          <ProgressBar label="Certification" current={stats.counts.certificate} total={50} color="#dc2626" />
          <ProgressBar label="Business MoUs" current={stats.counts.mou} total={20} color="#10b981" />
          <ProgressBar label="Invoices" current={stats.counts.invoice} total={40} color="#f59e0b" />
          
          <div style={{ marginTop: '2.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dotted var(--border)' }}>
             <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
               Organization performance is <strong>24% higher</strong> than last month.
             </p>
          </div>
        </div>

        <div className="card bento-card" style={{ padding: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Clock size={20} color="var(--accent)" />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Recent Activity</h3>
            </div>
            <ArrowUpRight size={18} style={{ opacity: 0.3 }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
             {records.slice(0, 5).map((r, i) => (
               <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingBottom: '1.5rem', borderBottom: i === 4 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: r.type === 'invoice' ? '#f59e0b' : '#2563eb' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 700 }}>{r.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.type} • {new Date(r.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent)' }}>PROC.</div>
               </div>
             ))}
             {records.length === 0 && (
               <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No recent activities detected.</p>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
