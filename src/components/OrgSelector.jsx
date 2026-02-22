import React, { useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { ChevronDown, Building, Plus, Check } from 'lucide-react';

const OrgSelector = () => {
  const { organizations, activeOrg, setActiveOrg, createOrganization } = useOrg();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    try {
      await createOrganization(newOrgName);
      setNewOrgName('');
      setIsCreating(false);
    } catch (err) {
      alert("Error creating organization: " + err.message);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-outline"
        style={{ height: '36px', padding: '0 0.75rem', fontSize: '0.8rem', gap: '0.5rem', border: '1px solid var(--border)' }}
      >
        <Building size={14} />
        <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeOrg ? activeOrg.name : 'Select Organization'}
        </span>
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div style={{ 
          position: 'absolute', 
          top: 'calc(100% + 8px)', 
          right: 0, 
          width: '240px', 
          background: 'var(--surface)', 
          border: '1px solid var(--border)', 
          borderRadius: 'var(--radius-md)', 
          boxShadow: 'var(--shadow-md)', 
          zIndex: 1000,
          padding: '0.5rem'
        }}>
          <div style={{ padding: '0.5rem', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your Organizations
          </div>
          
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {organizations.length === 0 ? (
              <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                No organizations found
              </div>
            ) : (
              organizations.map(org => (
                <button 
                  key={org.id}
                  onClick={() => { setActiveOrg(org); setIsOpen(false); }}
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    textAlign: 'left', 
                    background: activeOrg?.id === org.id ? 'var(--accent-light)' : 'transparent', 
                    border: 'none', 
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  {org.name}
                  {activeOrg?.id === org.id && <Check size={14} color="var(--accent)" />}
                </button>
              ))
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
            {isCreating ? (
              <form onSubmit={handleCreate} style={{ padding: '0.5rem' }}>
                <input 
                  autoFocus
                  placeholder="Org Name..."
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.5rem', marginBottom: '0.5rem' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1, padding: '0.25rem', height: '28px', fontSize: '0.75rem' }}>Save</button>
                  <button type="button" onClick={() => setIsCreating(false)} className="btn btn-outline" style={{ flex: 1, padding: '0.25rem', height: '28px', fontSize: '0.75rem' }}>Cancel</button>
                </div>
              </form>
            ) : (
              <button 
                onClick={() => setIsCreating(true)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 700 }}
              >
                <Plus size={14} />
                Create Organization
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OrgSelector;
