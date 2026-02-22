import { useState } from 'react';
import { FileText, Building, Users, Calendar, Gavel, ArrowRight, Download, Eye } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

export default function MoUForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [formData, setFormData] = useState({
    partyAName: '',
    partyBName: '',
    effectiveDate: '',
    terminationDate: '',
    purpose: '',
    confidentiality: true,
    jurisdiction: 'District Court of Karnataka, India',
    otherClauses: '',
    signatureA: null,
    signatureB: null
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await storageService.save(formData, 'mou', activeOrg?.id, user?.id);
      pdfService.generateMoU(formData);
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) onSuccess();
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving MoU: " + err.message);
      setIsSubmitting(false);
    }
  };

  const handlePreview = () => {
    pdfService.generateMoU(formData, true);
  };

  const SectionHeader = ({ icon: Icon, title }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1.25rem', paddingBottom: '0.5rem', borderBottom: '1.5px solid var(--background)' }}>
      <Icon size={18} color="rgba(255,255,255,0.8)" strokeWidth={2.5} />
      <span style={{ fontWeight: 800, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.025em', color: 'rgba(255,255,255,0.8)' }}>{title}</span>
    </div>
  );

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* 1. Contracting Parties */}
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <SectionHeader icon={Users} title="Contracting Parties" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-muted)' }}>PARTY A (First Party)</label>
              <input 
                name="partyAName"
                value={formData.partyAName}
                onChange={handleChange}
                placeholder="Name or Organization"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', color: 'white' }}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-muted)' }}>PARTY B (Second Party)</label>
              <input 
                name="partyBName"
                value={formData.partyBName}
                onChange={handleChange}
                placeholder="Name or Organization"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', color: 'white' }}
                required
              />
            </div>
          </div>
        </div>

        {/* 2. Agreement Details */}
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <SectionHeader icon={Calendar} title="Agreement Timeline" />
          <div className="form-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-muted)' }}>EFFECTIVE DATE</label>
              <input 
                type="date"
                name="effectiveDate"
                value={formData.effectiveDate}
                onChange={handleChange}
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', color: 'white' }}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-muted)' }}>EXPIRATION DATE</label>
              <input 
                type="date"
                name="terminationDate"
                value={formData.terminationDate}
                onChange={handleChange}
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', color: 'white' }}
                required
              />
            </div>
          </div>
        </div>

        {/* 3. Scope & Terms */}
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <SectionHeader icon={Gavel} title="Scope & Terms" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-muted)' }}>PURPOSE OF MoU</label>
              <textarea 
                name="purpose"
                value={formData.purpose}
                onChange={handleChange}
                placeholder="Describe the primary objective of this agreement..."
                rows={3}
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', color: 'white', resize: 'none' }}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-muted)' }}>JURISDICTION / GOVERNING LAW</label>
              <input 
                name="jurisdiction"
                value={formData.jurisdiction}
                onChange={handleChange}
                placeholder="e.g. State Court of India"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', color: 'white' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input 
                type="checkbox"
                name="confidentiality"
                checked={formData.confidentiality}
                onChange={handleChange}
                id="confidentiality"
                style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
              />
              <label htmlFor="confidentiality" style={{ fontSize: '0.875rem', color: 'white', cursor: 'pointer' }}>Includes Confidentiality Clause</label>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="form-grid" style={{ marginTop: '1rem', gap: '1rem' }}>
          <button 
            type="button"
            onClick={handlePreview}
            className="btn-cinematic btn-secondary"
            style={{ width: '100%', padding: '1rem' }}
          >
            <Eye size={18} /> Preview
          </button>
          <button 
            type="submit"
            disabled={isSubmitting}
            className="btn-cinematic"
            style={{ width: '100%', padding: '1rem' }}
          >
            {isSubmitting ? 'Syncing...' : 'Save & Download MoU'}
          </button>
        </div>

      </form>
    </div>
  );
}
