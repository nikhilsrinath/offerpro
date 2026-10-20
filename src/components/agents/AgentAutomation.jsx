import { useState } from 'react';
import { Play, Settings2, X, AlertTriangle } from 'lucide-react';

/*
 * The automatic-run pieces the Deal and Business Intelligence pages share:
 * the header's Settings and Run Now, the result line, the settings form and
 * Recent Runs. The same markup the Compliance and Deadline and Operations
 * Monitoring pages have, so all four look and behave alike. Their state is
 * useAutoPanel (automation.js).
 */

export function AutoButtons({ panel, disabled, onRun, children }) {
    return (
        <>
            <button type="button" className="ag-btn" onClick={() => panel.setSettingsOpen((v) => !v)} aria-expanded={panel.settingsOpen}>
                <Settings2 size={14} strokeWidth={2} aria-hidden="true" />Settings
            </button>
            {children}
            <button type="button" className="ag-btn is-primary" onClick={onRun} disabled={panel.running || disabled}
                title="Send alerts for anything new to owners and admins now">
                <Play size={13} strokeWidth={2.2} aria-hidden="true" />{panel.running ? 'Running…' : 'Run Now'}
            </button>
        </>
    );
}

export function AutoFlash({ panel }) {
    if (!panel.flash) return null;
    return (
        <div className={`ag-flash is-${panel.flash.tone}`} role="status">
            <span>{panel.flash.text}</span>
            <button type="button" onClick={() => panel.setFlash(null)} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
        </div>
    );
}

/**
 * The settings form. toggles: [[key, label, help]]; numbers: [[key, label, unit, max]];
 * `children(form, set, disabled)` adds fields of the agent's own at the end of the grid;
 * `critical` false for an agent whose findings are never critical.
 */
export function AutoSettings({ value, disabled, toggles, numbers, onSave, onClose, children, critical = true }) {
    const [form, setForm] = useState(value);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setErr('');
        try {
            await onSave(form);
        } catch (error) {
            setErr(error.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <form className="ag-settings" onSubmit={save}>
            <header className="ag-sec-h">
                Settings<span className="ag-sec-hint">Only owners and admins can change these. Alerts go to owners and admins.</span>
                <button type="button" className="ag-link" onClick={onClose} aria-label="Close settings"><X size={14} aria-hidden="true" /></button>
            </header>
            <div className="ag-set-grid">
                {toggles.map(([k, label, help]) => (
                    <label key={k} className="ag-toggle">
                        <input type="checkbox" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} disabled={disabled} />
                        <span><b>{label}</b><small>{help}</small></span>
                    </label>
                ))}
                {numbers.map(([k, label, unit, max = 365]) => (
                    <label key={k} className="ag-field">
                        <span>{label}</span>
                        <span className="ag-num">
                            <input type="number" min="0" max={max} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} disabled={disabled} />
                            <small>{unit}</small>
                        </span>
                    </label>
                ))}
                <label className="ag-field">
                    <span>Alert From</span>
                    <select value={form.notify_min} onChange={(e) => set('notify_min', e.target.value)} disabled={disabled}>
                        {critical && <option value="critical">Critical only</option>}
                        <option value="high">{critical ? 'High and critical' : 'High only'}</option>
                        <option value="medium">Medium and above</option>
                        <option value="low">Everything</option>
                    </select>
                </label>
                {children?.(form, set, disabled)}
            </div>
            {err && <p className="ag-err" role="alert"><AlertTriangle size={14} aria-hidden="true" />{err}</p>}
            <div className="ag-set-foot">
                <button type="button" className="ag-btn" onClick={onClose}>Cancel</button>
                <button type="submit" className="ag-btn is-primary" disabled={saving || disabled}>{saving ? 'Saving…' : 'Save Settings'}</button>
            </div>
        </form>
    );
}

const EMAIL_TEXT = { sent: 'emailed', not_configured: 'email not set up', failed: 'email failed', rate_limited: 'email limit reached', no_recipients: 'no email address', off: '' };

export function AgentRuns({ runs }) {
    if (!runs?.length) {
        return (
            <section className="ag-sec ag-runs">
                <header className="ag-sec-h">Recent Runs</header>
                <p className="ag-runs-none">No runs yet. Use Run Now, or turn on Run Automatically on the agent&apos;s card or in Settings.</p>
            </section>
        );
    }
    const kind = (r) => (String(r.run_key).includes('week') ? (r.trigger === 'manual' ? 'Weekly summary, by hand' : 'Weekly summary')
        : r.trigger === 'manual' ? 'Run by hand' : 'Daily run');
    return (
        <section className="ag-sec ag-runs">
            <header className="ag-sec-h">Recent Runs</header>
            {runs.map((r) => (
                <div key={r.id} className="ag-run">
                    <span className={`ag-dot is-${r.status === 'failed' ? 'critical' : r.status === 'running' ? 'medium' : 'ok'}`} aria-hidden="true" />
                    <span className="ag-run-t">{kind(r)} · {new Date(r.started_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="ag-run-m">
                        {r.status === 'failed' ? (r.error || 'Failed') : r.status === 'running' ? 'Running…'
                            : r.stats?.weekly ? ['summary sent', EMAIL_TEXT[r.stats?.email] || ''].filter(Boolean).join(' · ')
                                : [`${r.stats?.findings ?? 0} found`, `${r.stats?.alerted ?? 0} alerted`, EMAIL_TEXT[r.stats?.email] || ''].filter(Boolean).join(' · ')}
                        {r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}
                    </span>
                </div>
            ))}
        </section>
    );
}
