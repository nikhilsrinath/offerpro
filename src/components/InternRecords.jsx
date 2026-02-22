import { useState, useEffect } from 'react';
import { Download, Trash2, Search, FileSpreadsheet, Building, Calendar, ClipboardCheck, FileText, Award, Briefcase, FileCode } from 'lucide-react';
import { storageService } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

export default function InternRecords() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [records, setRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

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
    if (window.confirm('Delete record?')) {
      try {
        await storageService.delete(id);
        loadRecords();
      } catch (err) {
        alert("Error deleting record: " + err.message);
      }
    }
  };

  const handleDownloadPDF = (record) => {
    if (record.type === 'offer') {
      pdfService.generateOfferLetter(record.data);
    } else if (record.type === 'certificate') {
      pdfService.generateCertificate(record.data);
    } else if (record.type === 'mou') {
      pdfService.generateMoU(record.data);
    } else if (record.type === 'invoice') {
      pdfService.generateInvoice(record.data);
    }
  };

  const filteredRecords = records.filter(r => 
    r.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.type?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Search Header */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Search records..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '2.5rem', height: '44px', borderRadius: 'var(--radius-md)' }}
          />
        </div>
        <button onClick={() => storageService.exportToCSV()} className="btn btn-outline" style={{ height: '44px', padding: '0 1rem' }} disabled={records.length === 0}>
          <FileSpreadsheet size={18} />
          <span className="hide-mobile">Export CSV</span>
        </button>
      </div>

      {/* Desktop Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="desktop-table">
          <thead style={{ background: 'var(--background)' }}>
            <tr>
              <th style={{ padding: '1rem 1.5rem', textAlign: 'left' }}><label>Intern / Org</label></th>
              <th style={{ padding: '1rem', textAlign: 'left' }}><label>Role Info</label></th>
              <th style={{ padding: '1rem', textAlign: 'left' }}><label>Status</label></th>
              <th style={{ padding: '1rem 1.5rem', textAlign: 'right' }}><label>Actions</label></th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((record) => (
              <tr key={record.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ 
                      width: '32px', 
                      height: '32px', 
                      borderRadius: '8px', 
                      background: record.type === 'offer' ? '#eff6ff' : record.type === 'certificate' ? '#fef2f2' : record.type === 'mou' ? '#f0fdf4' : '#fff7ed', 
                      color: record.type === 'offer' ? '#2563eb' : record.type === 'certificate' ? '#dc2626' : record.type === 'mou' ? '#16a34a' : '#ea580c',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {record.type === 'offer' ? <Briefcase size={16} /> : record.type === 'certificate' ? <Award size={16} /> : record.type === 'mou' ? <FileCode size={16} /> : <FileText size={16} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{record.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                        {record.type} Generation
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                    {record.type === 'offer' ? record.data?.role : record.type === 'certificate' ? record.data?.achievementTitle : record.type === 'mou' ? 'Legal Agreement' : `Total: ₹${record.data?.totals?.grandTotal?.toLocaleString()}`}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {record.type === 'offer' ? record.data?.department : record.type === 'certificate' ? record.data?.issuingOrganization : record.type === 'mou' ? record.data?.jurisdiction : `Due: ${record.data?.dueDate}`}
                  </div>
                </td>
                <td style={{ padding: '1rem' }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>
                    {new Date(record.created_at).toLocaleDateString()}
                  </div>
                </td>
                <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => handleDownloadPDF(record)} className="btn btn-outline" style={{ padding: '0.5rem', height: '32px' }} title="PDF">
                      <Download size={14} />
                    </button>
                    <button onClick={() => handleDelete(record.id)} className="btn btn-outline" style={{ padding: '0.5rem', height: '32px', color: 'var(--error)', borderColor: '#fee2e2' }} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Minimal Mobile Record List (Fixed Alignment) */}
        <div className="mobile-cards" style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          {filteredRecords.map((record) => (
            <div key={record.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '1.25rem var(--space-4)', 
              borderBottom: '1px solid var(--border)',
              gap: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 0 }}>
                <div style={{ 
                  width: '40px', 
                  height: '40px', 
                  borderRadius: '10px', 
                  background: record.type === 'offer' ? '#eff6ff' : record.type === 'certificate' ? '#fef2f2' : record.type === 'mou' ? '#f0fdf4' : '#fff7ed', 
                  color: record.type === 'offer' ? '#2563eb' : record.type === 'certificate' ? '#dc2626' : record.type === 'mou' ? '#16a34a' : '#ea580c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {record.type === 'offer' ? <Briefcase size={20} /> : record.type === 'certificate' ? <Award size={20} /> : record.type === 'mou' ? <FileCode size={20} /> : <FileText size={20} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ 
                    fontSize: '1rem', 
                    fontWeight: 700, 
                    margin: 0, 
                    color: 'var(--primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {record.title}
                  </h4>
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--text-muted)', 
                    fontWeight: 600,
                    textTransform: 'capitalize'
                  }}>
                    {record.type} • {new Date(record.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <button 
                  onClick={() => handleDownloadPDF(record)} 
                  className="btn btn-outline" 
                  style={{ 
                    width: '38px', 
                    height: '38px', 
                    padding: 0, 
                    borderRadius: '8px',
                    color: 'var(--accent)',
                    borderColor: 'var(--accent-light)',
                    background: 'var(--accent-light)'
                  }}
                >
                  <Download size={16} />
                </button>
                <button 
                  onClick={() => handleDelete(record.id)} 
                  className="btn btn-outline" 
                  style={{ 
                    width: '38px', 
                    height: '38px', 
                    padding: 0, 
                    borderRadius: '8px',
                    color: 'var(--error)',
                    borderColor: '#fee2e2',
                    background: '#fef2f2'
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredRecords.length === 0 && (
          <div style={{ textAlign: 'center', padding: '5rem 2rem' }}>
            <ClipboardCheck size={48} color="var(--border)" strokeWidth={1} style={{ marginBottom: '1rem' }} />
            <p style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Empty Database</p>
          </div>
        )}
      </div>
    </div>
  );
}
