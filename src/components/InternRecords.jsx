import { useState, useEffect, useMemo } from 'react';
import { Download, Trash2, Search, FileSpreadsheet, ClipboardCheck, FileText, Award, Briefcase, FileCode, LayoutGrid, List, Eye, Send, Loader, CheckCircle } from 'lucide-react';
import { storageService } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { emailService } from '../services/emailService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

const TYPE_CONFIG = {
  offer: { icon: Briefcase, color: '#3b82f6', bg: '#3b82f612', bgSolid: 'rgba(59,130,246,0.08)', label: 'Offer Letter' },
  certificate: { icon: Award, color: '#f59e0b', bg: '#f59e0b12', bgSolid: 'rgba(245,158,11,0.08)', label: 'Certificate' },
  nda: { icon: FileCode, color: '#10b981', bg: '#10b98112', bgSolid: 'rgba(16,185,129,0.08)', label: 'NDA' },
  mou: { icon: FileCode, color: '#14b8a6', bg: '#14b8a612', bgSolid: 'rgba(20,184,166,0.08)', label: 'MoU' },
  invoice: { icon: FileText, color: '#8b5cf6', bg: '#8b5cf612', bgSolid: 'rgba(139,92,246,0.08)', label: 'Invoice' }
};

const TABS = [
  { id: 'all', label: 'All Documents' },
  { id: 'offer', label: 'Offer Letters' },
  { id: 'certificate', label: 'Certificates' },
  { id: 'nda', label: 'NDAs' },
  { id: 'mou', label: 'MoUs' },
  { id: 'invoice', label: 'Invoices' },
];

export default function InternRecords() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [records, setRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [activeTab, setActiveTab] = useState('all');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(null); // record id being sent
  const [emailStatus, setEmailStatus] = useState(null); // { id, success, message }

  useEffect(() => {
    if (activeOrg) loadRecords();
  }, [activeOrg]);

  const loadRecords = async () => {
    setLoading(true);
    const data = await storageService.getAll(activeOrg?.id);
    setRecords(data);
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this record permanently?')) {
      try {
        await storageService.delete(id, activeOrg?.id);
        loadRecords();
      } catch (err) {
        alert("Error deleting record: " + err.message);
      }
    }
  };

  const handleDownloadPDF = async (record) => {
    if (record.type === 'offer') await pdfService.generateOfferLetter(record.data);
    else if (record.type === 'certificate') pdfService.generateCertificate(record.data);
    else if (record.type === 'nda') await pdfService.generateNda(record.data);
    else if (record.type === 'mou') await pdfService.generateMoU(record.data);
    else if (record.type === 'invoice') pdfService.generateInvoice(record.data);
  };

  const handleNotify = async (record) => {
    if (sendingEmail) return;
    setSendingEmail(record.id);
    setEmailStatus(null);

    const result = await emailService.sendOfferNotification({
      recordData: record.data,
      emailConfig: {
        serviceId: activeOrg?.emailjs_service_id,
        templateId: activeOrg?.emailjs_template_id,
        publicKey: activeOrg?.emailjs_public_key,
      },
      companyName: activeOrg?.company_name || 'Company',
    });

    setEmailStatus({ id: record.id, ...result });
    setSendingEmail(null);

    if (result.success) {
      setTimeout(() => setEmailStatus(null), 4000);
    } else {
      setTimeout(() => setEmailStatus(null), 6000);
    }
  };

  const counts = useMemo(() => ({
    all: records.length,
    offer: records.filter(r => r.type === 'offer').length,
    certificate: records.filter(r => r.type === 'certificate').length,
    nda: records.filter(r => r.type === 'nda').length,
    mou: records.filter(r => r.type === 'mou').length,
    invoice: records.filter(r => r.type === 'invoice').length,
  }), [records]);

  const filteredRecords = useMemo(() => {
    let filtered = records;
    if (activeTab !== 'all') {
      filtered = filtered.filter(r => r.type === activeTab);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        r.title?.toLowerCase().includes(term) ||
        r.type?.toLowerCase().includes(term)
      );
    }
    return [...filtered].sort((a, b) => {
      if (sortBy === 'date_desc')   return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (sortBy === 'date_asc')    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (sortBy === 'title_asc')   return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'title_desc')  return (b.title || '').localeCompare(a.title || '');
      return 0;
    });
  }, [records, activeTab, searchTerm, sortBy]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="records-page">

      {/* Summary Cards */}
      <div className="records-summary-grid">
        {TABS.filter(t => t.id !== 'all').map(tab => {
          const cfg = TYPE_CONFIG[tab.id];
          const Icon = cfg.icon;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              className={`records-summary-card ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(activeTab === tab.id ? 'all' : tab.id)}
              style={{ '--card-color': cfg.color, '--card-bg': cfg.bgSolid }}
            >
              <div className="records-summary-icon" style={{ background: cfg.bg, color: cfg.color }}>
                <Icon size={20} />
              </div>
              <div className="records-summary-info">
                <span className="records-summary-count">{count}</span>
                <span className="records-summary-label">{tab.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar: Tabs + Search + View Toggle + Export */}
      <div className="records-toolbar">
        <div className="records-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`records-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span className="records-tab-count">{counts[tab.id]}</span>
            </button>
          ))}
        </div>
        <div className="records-toolbar-right">
          <div className="records-search-wrap">
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pro-input"
              style={{ paddingLeft: '2rem', height: '36px', fontSize: '0.8125rem' }}
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              height: '36px', padding: '0 0.625rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border-default)',
              background: 'var(--background)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem', cursor: 'pointer', outline: 'none', flexShrink: 0,
            }}
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="title_asc">Title A–Z</option>
            <option value="title_desc">Title Z–A</option>
          </select>
          <div className="records-toolbar-actions">
            <div className="records-view-toggle">
              <button className={`records-view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Grid view">
                <LayoutGrid size={16} />
              </button>
              <button className={`records-view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} title="List view">
                <List size={16} />
              </button>
            </div>
            <button onClick={() => storageService.exportToCSV(records)} className="records-export-btn" disabled={records.length === 0}>
              <FileSpreadsheet size={16} />
              <span className="hide-mobile">Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filteredRecords.length === 0 ? (
        <div className="pro-card">
          <div className="pro-empty" style={{ padding: '5rem 2rem' }}>
            <ClipboardCheck size={48} strokeWidth={1} />
            <p>{searchTerm ? 'No matching records' : activeTab !== 'all' ? `No ${TYPE_CONFIG[activeTab]?.label || ''} records` : 'No records yet'}</p>
            <span>{searchTerm ? 'Try a different search term' : 'Create documents to see them here'}</span>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="records-grid">
          {filteredRecords.map((record) => {
            const cfg = TYPE_CONFIG[record.type] || TYPE_CONFIG.offer;
            const Icon = cfg.icon;
            return (
              <div key={record.id} className="records-grid-card">
                <div className="records-grid-card-header">
                  <div className="records-grid-card-icon" style={{ background: cfg.bg, color: cfg.color }}>
                    <Icon size={20} />
                  </div>
                  <span className="records-grid-card-type" style={{ color: cfg.color, background: cfg.bg }}>
                    {cfg.label}
                  </span>
                </div>

                <h4 className="records-grid-card-title">{record.title}</h4>

                <div className="records-grid-card-detail">
                  {record.type === 'offer' && record.data?.role && (
                    <span>{record.data.role}{record.data.department ? ` · ${record.data.department}` : ''}</span>
                  )}
                  {record.type === 'certificate' && record.data?.achievementTitle && (
                    <span>{record.data.achievementTitle}</span>
                  )}
                  {record.type === 'nda' && (
                    <span>{record.data?.receivingPartyName ? `with ${record.data.receivingPartyName}` : 'NDA Agreement'}</span>
                  )}
                  {record.type === 'mou' && (
                    <span>{record.data?.secondPartyName ? `with ${record.data.secondPartyName}` : 'MoU Agreement'}</span>
                  )}
                  {record.type === 'invoice' && (
                    <span>₹{record.data?.totals?.grandTotal?.toLocaleString() || '0'}{record.data?.invoiceNumber ? ` · ${record.data.invoiceNumber}` : ''}</span>
                  )}
                </div>

                <div className="records-grid-card-date">
                  {new Date(record.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>

                <div className="records-grid-card-actions">
                  <button onClick={() => handleDownloadPDF(record)} className="records-action-btn download" title="Download PDF">
                    <Download size={14} /> Download
                  </button>
                  {record.type === 'offer' && record.data?.email && (
                    <button
                      onClick={() => handleNotify(record)}
                      className={`records-action-btn notify ${emailStatus?.id === record.id ? (emailStatus.success ? 'sent' : 'failed') : ''}`}
                      title={`Send offer to ${record.data.email}`}
                      disabled={sendingEmail === record.id}
                    >
                      {sendingEmail === record.id ? <><Loader size={13} className="spin-icon" /> Sending</>
                        : emailStatus?.id === record.id && emailStatus.success ? <><CheckCircle size={13} /> Sent</>
                        : <><Send size={13} /> Notify</>}
                    </button>
                  )}
                  <button onClick={() => handleDelete(record.id)} className="records-action-btn delete" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="pro-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="desktop-table">
            <thead>
              <tr>
                <th style={{ padding: '0.875rem 1.5rem', textAlign: 'left' }}><label style={{ margin: 0 }}>Document</label></th>
                <th style={{ padding: '0.875rem 1rem', textAlign: 'left' }}><label style={{ margin: 0 }}>Details</label></th>
                <th style={{ padding: '0.875rem 1rem', textAlign: 'left' }}><label style={{ margin: 0 }}>Date</label></th>
                <th style={{ padding: '0.875rem 1.5rem', textAlign: 'right' }}><label style={{ margin: 0 }}>Actions</label></th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => {
                const cfg = TYPE_CONFIG[record.type] || TYPE_CONFIG.offer;
                const Icon = cfg.icon;
                return (
                  <tr key={record.id}>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                          width: '34px', height: '34px', borderRadius: '9px',
                          background: cfg.bg, color: cfg.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <Icon size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{record.title}</div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                            {cfg.label}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>
                        {record.type === 'offer' ? record.data?.role
                          : record.type === 'certificate' ? record.data?.achievementTitle
                          : record.type === 'nda' ? 'NDA Agreement'
                          : record.type === 'mou' ? 'MoU Agreement'
                          : `₹${record.data?.totals?.grandTotal?.toLocaleString()}`}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        {record.type === 'offer' ? record.data?.department
                          : record.type === 'certificate' ? record.data?.issuingOrganization
                          : record.type === 'nda' ? (record.data?.arbitrationCity ? `${record.data.arbitrationCity}, ${record.data.arbitrationState}` : '')
                          : record.type === 'mou' ? (record.data?.arbitrationCity || '')
                          : `Due: ${record.data?.dueDate}`}
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
                        {new Date(record.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => handleDownloadPDF(record)} className="btn btn-outline" style={{ padding: '0.375rem 0.75rem', height: '30px', fontSize: '0.75rem' }} title="Download PDF">
                          <Download size={13} /> PDF
                        </button>
                        {record.type === 'offer' && record.data?.email && (
                          <button
                            onClick={() => handleNotify(record)}
                            className={`records-action-btn notify compact ${emailStatus?.id === record.id ? (emailStatus.success ? 'sent' : 'failed') : ''}`}
                            title={`Send offer to ${record.data.email}`}
                            disabled={sendingEmail === record.id}
                            style={{ padding: '0.375rem 0.625rem', height: '30px', fontSize: '0.75rem' }}
                          >
                            {sendingEmail === record.id ? <Loader size={12} className="spin-icon" />
                              : emailStatus?.id === record.id && emailStatus.success ? <CheckCircle size={12} />
                              : <Send size={12} />}
                          </button>
                        )}
                        <button onClick={() => handleDelete(record.id)} className="pro-delete-btn" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile Cards (shown on mobile regardless of viewMode) */}
          <div className="mobile-cards" style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredRecords.map((record) => {
              const cfg = TYPE_CONFIG[record.type] || TYPE_CONFIG.offer;
              const Icon = cfg.icon;
              return (
                <div key={record.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '1.25rem', borderBottom: '1px solid var(--border-subtle)', gap: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '10px',
                      background: cfg.bg, color: cfg.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      <Icon size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {record.title}
                      </h4>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {cfg.label} · {new Date(record.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    <button onClick={() => handleDownloadPDF(record)} className="btn btn-outline" style={{ width: '36px', height: '36px', padding: 0, borderRadius: '8px' }}>
                      <Download size={14} />
                    </button>
                    {record.type === 'offer' && record.data?.email && (
                      <button
                        onClick={() => handleNotify(record)}
                        className={`records-action-btn notify compact ${emailStatus?.id === record.id ? (emailStatus.success ? 'sent' : '') : ''}`}
                        disabled={sendingEmail === record.id}
                        style={{ width: '36px', height: '36px', padding: 0, borderRadius: '8px' }}
                      >
                        {sendingEmail === record.id ? <Loader size={14} className="spin-icon" />
                          : emailStatus?.id === record.id && emailStatus.success ? <CheckCircle size={14} />
                          : <Send size={14} />}
                      </button>
                    )}
                    <button onClick={() => handleDelete(record.id)} className="pro-delete-btn" style={{ width: '36px', height: '36px' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer count */}
      {filteredRecords.length > 0 && (
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          Showing {filteredRecords.length} of {records.length} record{records.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Email Status Toast */}
      {emailStatus && (
        <div className={`email-toast ${emailStatus.success ? 'success' : 'error'} animate-in`}>
          {emailStatus.success ? <CheckCircle size={16} /> : <Send size={16} />}
          <span>{emailStatus.message}</span>
        </div>
      )}
    </div>
  );
}
