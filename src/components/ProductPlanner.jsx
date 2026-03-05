import { useState, useEffect } from 'react';
import {
  Plus, Trash2, Clock, CheckCircle,
  Circle, Layers, Calendar, Flag
} from 'lucide-react';
import { ref, push, set, get, remove, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useOrg } from '../context/OrgContext';

const STATUS_CONFIG = {
  planned: { label: 'Planned', color: '#94a3b8', icon: Circle, bg: '#94a3b810' },
  in_progress: { label: 'In Progress', color: '#3b82f6', icon: Clock, bg: '#3b82f610' },
  completed: { label: 'Completed', color: '#10b981', icon: CheckCircle, bg: '#10b98110' }
};

const PRIORITY_CONFIG = {
  low: { label: 'Low', color: '#94a3b8' },
  medium: { label: 'Medium', color: '#f59e0b' },
  high: { label: 'High', color: '#ef4444' }
};

export default function ProductPlanner() {
  const { activeOrg } = useOrg();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('all');
  const [newItem, setNewItem] = useState({
    name: '',
    description: '',
    status: 'planned',
    priority: 'medium',
    due_date: ''
  });

  useEffect(() => {
    if (activeOrg) loadProducts();
  }, [activeOrg]);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const prodRef = ref(db, `products/${activeOrg.id}`);
      const snap = await get(prodRef);
      if (snap.exists()) {
        const items = [];
        snap.forEach(child => items.push({ id: child.key, ...child.val() }));
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setProducts(items);
      } else {
        setProducts([]);
      }
    } catch (err) {
      console.error("Error loading products:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newItem.name) return;

    const prodRef = push(ref(db, `products/${activeOrg.id}`));
    await set(prodRef, { ...newItem, created_at: new Date().toISOString() });

    setNewItem({ name: '', description: '', status: 'planned', priority: 'medium', due_date: '' });
    setShowAdd(false);
    loadProducts();
  };

  const handleStatusChange = async (id, newStatus) => {
    await update(ref(db, `products/${activeOrg.id}/${id}`), { status: newStatus });
    loadProducts();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this item?')) return;
    await remove(ref(db, `products/${activeOrg.id}/${id}`));
    loadProducts();
  };

  const filtered = filter === 'all' ? products : products.filter(p => p.status === filter);

  const counts = {
    all: products.length,
    planned: products.filter(p => p.status === 'planned').length,
    in_progress: products.filter(p => p.status === 'in_progress').length,
    completed: products.filter(p => p.status === 'completed').length
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading planner...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Toolbar */}
      <div className="planner-toolbar">
        <div className="planner-filters">
          {[
            { id: 'all', label: 'All' },
            { id: 'planned', label: 'Planned' },
            { id: 'in_progress', label: 'In Progress' },
            { id: 'completed', label: 'Done' }
          ].map(f => (
            <button key={f.id}
              className={`pro-chip ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              {f.label}
              <span style={{
                fontSize: '0.6875rem', background: 'rgba(255,255,255,0.07)',
                padding: '0.1rem 0.375rem', borderRadius: '4px', fontWeight: 700
              }}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <button className="billing-add-btn" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={16} /> New Item
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <form className="pro-card" onSubmit={handleAdd} style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <input type="text" placeholder="Product / Project name" value={newItem.name}
              onChange={e => setNewItem({ ...newItem, name: e.target.value })} required
              className="pro-input" style={{ fontSize: '1rem', fontWeight: 600 }} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <textarea placeholder="Description (optional)" value={newItem.description}
              onChange={e => setNewItem({ ...newItem, description: e.target.value })} rows={2}
              className="pro-input" style={{ resize: 'none' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <select value={newItem.priority} onChange={e => setNewItem({ ...newItem, priority: e.target.value })} className="pro-input">
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
            </select>
            <select value={newItem.status} onChange={e => setNewItem({ ...newItem, status: e.target.value })} className="pro-input">
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            <input type="date" value={newItem.due_date}
              onChange={e => setNewItem({ ...newItem, due_date: e.target.value })} className="pro-input" />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="billing-save-btn">Add Item</button>
            <button type="button" className="billing-cancel-btn" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Items List */}
      <div className="planner-list">
        {filtered.length === 0 ? (
          <div className="pro-empty" style={{ padding: '4rem' }}>
            <Layers size={40} strokeWidth={1} />
            <p>{filter === 'all' ? 'No products or projects yet' : `No ${filter.replace('_', ' ')} items`}</p>
            <span>Click "New Item" to start planning</span>
          </div>
        ) : (
          filtered.map(item => {
            const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.planned;
            const priorityCfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
            const StatusIcon = statusCfg.icon;

            return (
              <div key={item.id} className="planner-item">
                <div className="planner-item-left">
                  <button className="planner-status-btn" style={{ color: statusCfg.color }}
                    onClick={() => {
                      const cycle = { planned: 'in_progress', in_progress: 'completed', completed: 'planned' };
                      handleStatusChange(item.id, cycle[item.status]);
                    }}
                    title={`Click to change (${statusCfg.label})`}>
                    <StatusIcon size={20} />
                  </button>

                  <div className="planner-item-content">
                    <div className="planner-item-header">
                      <span className={`planner-item-name ${item.status === 'completed' ? 'completed' : ''}`}>{item.name}</span>
                      <span className="planner-priority-badge" style={{ color: priorityCfg.color, background: `${priorityCfg.color}15` }}>
                        <Flag size={10} /> {priorityCfg.label}
                      </span>
                    </div>
                    {item.description && <span className="planner-item-desc">{item.description}</span>}
                    <div className="planner-item-meta">
                      <span className="planner-status-label" style={{ color: statusCfg.color, background: statusCfg.bg }}>
                        {statusCfg.label}
                      </span>
                      {item.due_date && (
                        <span className="planner-due-date">
                          <Calendar size={12} /> {new Date(item.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button className="billing-delete-btn" onClick={() => handleDelete(item.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
