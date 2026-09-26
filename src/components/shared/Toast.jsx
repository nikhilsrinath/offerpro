import { useState, createContext, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, AlertTriangle, Info } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46', icon: '#059669' },
  error: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', icon: '#dc2626' },
  warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', icon: '#f59e0b' },
  info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', icon: '#3b82f6' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // `action` ({ label, onClick }) adds one button — e.g. "Start project" after
  // a CRM deal is won. A toast with an action stays long enough to use it.
  const addToast = useCallback((message, type = 'success', duration = 3000, action = null) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {/* Announced as they arrive; errors interrupt, everything else waits its turn. */}
      <div className="toast-container" role="region" aria-label="Notifications">
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.type] || ICONS.info;
            const colors = COLORS[toast.type] || COLORS.info;
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="toast-item"
                role={toast.type === 'error' ? 'alert' : 'status'}
                style={{ background: colors.bg, borderColor: colors.border, color: colors.text }}
              >
                <Icon aria-hidden="true" size={16} style={{ color: colors.icon, flexShrink: 0 }} />
                <span>{toast.message}</span>
                {toast.action && (
                  <button type="button" className="toast-close" style={{ width: 'auto', padding: '0 8px', fontWeight: 600 }}
                    onClick={() => { toast.action.onClick(); setToasts((prev) => prev.filter((t) => t.id !== toast.id)); }}>
                    {toast.action.label}
                  </button>
                )}
                <button
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  type="button"
                  className="toast-close"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return () => {};
  }
  return ctx;
}
