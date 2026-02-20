import { useState, useEffect } from 'react';
import { Download, Trash2, Search, FileSpreadsheet, Building, Calendar, ClipboardCheck } from 'lucide-react';
import { storageService } from '../services/storageService';
import { pdfService } from '../services/pdfService';

export default function InternRecords() {
  const [records, setRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = () => setRecords(storageService.getAll());

  const handleDelete = (id) => {
    if (window.confirm('Delete record?')) {
      storageService.delete(id);
      loadRecords();
    }
  };

  const handleDownloadPDF = (record) => pdfService.generateOfferLetter(record);

  const filteredRecords = records.filter(r => 
    r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.companyName.toLowerCase().includes(searchTerm.toLowerCase())
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
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{record.studentName}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <Building size={12} /> {record.companyName}
                  </div>
                </td>
                <td style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{record.role}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{record.department}</div>
                </td>
                <td style={{ padding: '1rem' }}>
                  <span className={`badge ${record.isPaid ? 'badge-success' : 'badge-info'}`}>
                    {record.isPaid ? 'PAID' : 'UNPAID'}
                  </span>
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4 style={{ 
                  fontSize: '1rem', 
                  fontWeight: 700, 
                  margin: 0, 
                  color: 'var(--primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {record.studentName}
                </h4>
                <div style={{ 
                  fontSize: '0.8125rem', 
                  color: 'var(--text-muted)', 
                  fontWeight: 600,
                  marginTop: '1px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {record.companyName}
                </div>
                <div style={{ 
                  fontSize: '0.75rem', 
                  color: 'var(--accent)', 
                  fontWeight: 500,
                  marginTop: '1px' 
                }}>
                  {record.role}
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
