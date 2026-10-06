import { useState } from 'react';
import { X } from 'lucide-react';
import { DialogSheet } from '../ui/edge';
import { customerService } from '../../services/customerService';
import { useOrg } from '../../context/OrgContext';
import { useToast } from './Toast';
import CountrySelect from './CountrySelect';
import ClientProjectSelect from './ClientProjectSelect';
import { useClientProjects } from './useClientProjects';
import { withDialCode } from '../../data/dialCodes';
import { OTHERS, assignProject } from '../../services/clientProjects';

/* The Add Client sheet, on its own so a form that needs a client (New project)
   can make one without leaving the page. It writes the same client row the
   Client Directory's Add Client does, so the new client is in the directory
   straight away. `onCreated(client)` receives the saved row. */

const EMPTY = {
    clientName: '', person_name: '', clientEmail: '', clientAddress: '',
    buyerGSTIN: '', buyerState: '', contactPhone: '', notes: '', country_code: '',
    project: OTHERS,
};

export default function AddClientDialog({ onClose, onCreated }) {
    const { activeOrg } = useOrg();
    const toast = useToast();
    const cp = useClientProjects();
    const [form, setForm] = useState(EMPTY);
    const [saving, setSaving] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const save = async (e) => {
        e.preventDefault();
        const company = form.clientName.trim();
        const contact = form.person_name.trim();
        if (!company && !contact) { toast('Enter a company name or a contact person', 'error'); return; }
        const { project, ...fields } = form;
        setSaving(true);
        try {
            const client = await customerService.create(activeOrg.id, { ...fields, clientName: company || contact, person_name: contact });
            if (client?.id && project !== OTHERS) {
                try { await assignProject(client.id, project, OTHERS, cp.projects, cp.links); }
                catch (err) { toast('Client saved, but the project could not be set: ' + err.message, 'error'); }
            }
            onCreated?.(client);
            onClose();
        } catch (err) {
            toast('Could not save the client: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="customer-modal-overlay" onClick={onClose}>
            <DialogSheet className="customer-modal" labelledBy="add-client-title" onClose={onClose}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <h3 id="add-client-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Add Client</h3>
                    <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose}
                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
                        <X aria-hidden="true" size={20} />
                    </button>
                </div>
                <form onSubmit={save}>
                    <div className="easy-row" style={{ gap: '1rem' }}>
                        <div className="easy-field">
                            <label className="easy-lbl">Contact person</label>
                            <input aria-label="Contact person" type="text" value={form.person_name} onChange={set('person_name')} className="easy-inp" autoFocus />
                        </div>
                        <div className="easy-field">
                            <label className="easy-lbl">Company name</label>
                            <input aria-label="Company name" type="text" value={form.clientName} onChange={set('clientName')} className="easy-inp" />
                        </div>
                        <div className="easy-field full">
                            <label className="easy-lbl" htmlFor="add-client-project">Project</label>
                            <ClientProjectSelect id="add-client-project" cp={cp} value={form.project}
                                onChange={(project) => setForm((f) => ({ ...f, project }))} />
                        </div>
                        <div className="easy-field">
                            <label className="easy-lbl">Email</label>
                            <input aria-label="Email" type="email" value={form.clientEmail} onChange={set('clientEmail')} className="easy-inp" />
                        </div>
                        <div className="easy-field">
                            <label className="easy-lbl">Phone</label>
                            <input aria-label="Phone" type="text" value={form.contactPhone} onChange={set('contactPhone')} className="easy-inp" />
                        </div>
                        <div className="easy-field full">
                            <label className="easy-lbl">Address</label>
                            <input aria-label="Address" type="text" value={form.clientAddress} onChange={set('clientAddress')} className="easy-inp" />
                        </div>
                        <div className="easy-field">
                            <label className="easy-lbl">GSTIN</label>
                            <input aria-label="GSTIN" type="text" value={form.buyerGSTIN}
                                onChange={(e) => setForm((f) => ({ ...f, buyerGSTIN: e.target.value.toUpperCase() }))}
                                className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                        </div>
                        <div className="easy-field">
                            <label className="easy-lbl">State</label>
                            <input aria-label="State" type="text" value={form.buyerState} onChange={set('buyerState')} className="easy-inp" />
                        </div>
                        <div className="easy-field">
                            <label className="easy-lbl">Country</label>
                            <CountrySelect ariaLabel="Country" value={form.country_code} placeholder=""
                                onChange={(code) => setForm((f) => ({ ...f, country_code: code, contactPhone: withDialCode(f.contactPhone, f.country_code, code) }))} />
                        </div>
                        <div className="easy-field full">
                            <label className="easy-lbl">Note</label>
                            <textarea aria-label="Note" rows={3} value={form.notes} onChange={set('notes')} className="easy-inp" style={{ resize: 'none' }} />
                        </div>
                    </div>
                    <div className="form-actions" style={{ marginTop: '1.5rem' }}>
                        <button type="button" onClick={onClose} className="easy-submit-outline">Cancel</button>
                        <button type="submit" disabled={saving} className="easy-submit">{saving ? 'Saving...' : 'Add Client'}</button>
                    </div>
                </form>
            </DialogSheet>
        </div>
    );
}
