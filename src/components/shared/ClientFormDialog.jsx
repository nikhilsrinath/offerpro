import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../financial/financeUi';
import { customerService } from '../../services/customerService';
import { orgStore } from '../../services/orgStore';
import { useOrg } from '../../context/OrgContext';
import { useToast } from './Toast';
import CountrySelect from './CountrySelect';
import ClientProjectSelect from './ClientProjectSelect';
import { useClientProjects } from './useClientProjects';
import { useProfileColumns } from './useProfileColumns';
import { withDialCode } from '../../data/dialCodes';
import { OTHERS, initialProject, assignProject } from '../../services/clientProjects';
import { updateProject, canEditProjects } from '../../services/projectService';
import { validate, isEmail, isPhone, isUrl, isGstin, contactErrors } from '../../services/projectWorkspace';
import { CLIENT_STATUSES, todayIso } from '../projects/parties/partyData';
import { LogoField, ContactsEditor } from '../projects/parties/partyUi';

/* The one Add / Edit Client panel. The Client Directory, New project's Add
   Client and a project's Client Directory all open this, so a client is made
   the same way wherever it is made.

   `project` puts it inside that project: no Project dropdown, and a new client
   is added to the project (as its client when it has none yet). Without it,
   the Project dropdown says where the client belongs.

   The profile fields from 0074 (logo, designation, website, contact persons…)
   show only when the database has them. `onSaved(client)` gets the saved row. */

const RULES = {
    clientEmail: [{ test: isEmail, message: 'That email does not look right.' }],
    contactPhone: [{ test: isPhone, message: 'Use 7–15 digits for the phone, with + ( ) - allowed.' }],
    alt_contact: [{ test: (v) => isEmail(v) || isPhone(v), message: 'The alternate contact is an email or a phone number.' }],
    website: [{ test: isUrl, message: 'That website does not look right.' }],
    // A GSTIN is Indian; a client abroad keeps whatever tax ID they have.
    buyerGSTIN: [{ test: (v, f) => (f.country_code && f.country_code !== 'IN') || isGstin(v), message: 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5.' }],
    client_since: [{ test: (v) => v <= todayIso(), message: 'Client since is in the future.' }],
};

const PROFILE = ['logo_path', 'industry', 'website', 'contact_designation', 'alt_contact', 'client_since', 'contacts'];

function initial(c, project) {
    return {
        // An individual is stored with their own name in both columns; the form
        // shows them as a contact with no company rather than repeating it.
        clientName: c?.clientName && c.clientName !== c.person_name ? c.clientName : '',
        person_name: c?.person_name || '',
        clientEmail: c?.clientEmail || '',
        contactPhone: c?.contactPhone || '',
        clientAddress: c?.clientAddress || '',
        buyerGSTIN: c?.buyerGSTIN || '',
        buyerState: c?.buyerState || '',
        // Optional. Left blank, a document billed to this client falls back to
        // the GST state and then to your organisation's own country, so Sales
        // by Countries works without it. It is here for when inference is wrong.
        country_code: c?.country_code || '',
        notes: c?.notes || '',
        status: c?.status || 'active',
        logo_path: c?.logo_path || null,
        industry: c?.industry || '',
        website: c?.website || '',
        contact_designation: c?.contact_designation || '',
        alt_contact: c?.alt_contact || '',
        client_since: c?.client_since || '',
        contacts: c?.contacts || [],
        project,
    };
}

export default function ClientFormDialog({ client = null, project = null, defaultProject = OTHERS, onClose, onSaved }) {
    const { activeOrg } = useOrg();
    const toast = useToast();
    const cp = useClientProjects();
    const profile = useProfileColumns('clients');
    // What the Project dropdown opened on, so an edit that changes it moves them.
    const [fromProject] = useState(() => (client ? initialProject(client.id, cp.projects, cp.links) : OTHERS));
    const [form, setForm] = useState(() => initial(client, client ? fromProject : defaultProject));
    const [problems, setProblems] = useState([]);
    const [saving, setSaving] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async (e) => {
        e.preventDefault();
        // Opened from inside another form (New project): its submit is not ours.
        e.stopPropagation();
        const company = form.clientName.trim();
        const contact = form.person_name.trim();
        const errs = validate(form, profile ? RULES : { ...RULES, alt_contact: [], website: [], client_since: [] });
        const list = [
            ...(!company && !contact ? ['Enter a company name or a contact person.'] : []),
            ...Object.values(errs),
            ...(profile ? contactErrors(form.contacts) : []),
        ];
        setProblems(list);
        if (list.length) return;

        // Billed under the company; an individual is billed under their own name.
        // `project` is not a client column; it is applied through the project links.
        const { project: chosen, ...fields } = form;
        if (!profile) PROFILE.forEach((k) => delete fields[k]);
        const data = { ...fields, clientName: company || contact, person_name: contact, buyerGSTIN: form.buyerGSTIN.trim().toUpperCase() };
        setSaving(true);
        try {
            let id = client?.id;
            if (client) await customerService.update(activeOrg.id, client.id, data);
            else id = (await customerService.create(activeOrg.id, data))?.id;

            if (id && project && !client) {
                try {
                    // A project with no client of its own takes this one as its client.
                    if (!project.client_id && canEditProjects()) await updateProject(project.id, { client_id: id });
                    else await orgStore.addItem('project_clients', { project_id: project.id, client_id: id });
                } catch (err) {
                    toast('Client saved, but not added to this project: ' + err.message, 'error');
                }
            } else if (id && !project) {
                try {
                    const { keptPrimary } = await assignProject(id, chosen, fromProject, cp.projects, cp.links);
                    if (keptPrimary) {
                        const p = cp.projects.find((x) => x.id === keptPrimary);
                        toast(`Still the main client of ${p?.name || 'their project'}. Change that from the project`, 'info');
                    }
                } catch (err) {
                    toast('Client saved, but the project could not be set: ' + err.message, 'error');
                }
            }
            const saved = orgStore.getSectionAsList('customers').find((c) => c.id === id) || { ...client, ...data, id };
            toast(client ? 'Client updated' : project ? 'Client added to the project' : 'Client added', 'success');
            onSaved?.(saved);
            onClose();
        } catch (err) {
            setProblems([`Could not save the client: ${err.message}`]);
        } finally {
            setSaving(false);
        }
    };

    const field = (label, k, input, full = false) => (
        <div className={`easy-field${full ? ' full' : ''}`}>
            <label className="easy-lbl" htmlFor={`client-${k}`}>{label}</label>
            {input}
        </div>
    );
    const text = (k, extra = {}) => (
        <input id={`client-${k}`} type="text" value={form[k]} onChange={set(k)} className="easy-inp" {...extra} />
    );

    return createPortal(
        <Modal title={client ? 'Edit Client' : 'Add Client'} onClose={onClose}>
            <form onSubmit={save} className="prod-modal-body" noValidate>
                {problems.length > 0 && (
                    <div className="prod-form-error" role="alert" style={{ marginBottom: '1rem' }}>
                        {problems.map((p) => <div key={p}>{p}</div>)}
                    </div>
                )}
                <div className="easy-row" style={{ gap: '1rem' }}>
                    {profile && (
                        <div className="easy-field full">
                            <span className="easy-lbl">Logo</span>
                            <LogoField kind="clients" value={form.logo_path} name={form.clientName || form.person_name} onChange={set('logo_path')} />
                        </div>
                    )}
                    {field('Contact person', 'person_name', text('person_name', { autoFocus: true }))}
                    {field('Company name', 'clientName', text('clientName', { maxLength: 200 }))}
                    {profile && field('Designation', 'contact_designation', text('contact_designation'))}
                    {profile && field('Industry', 'industry', text('industry', { placeholder: 'Retail, Healthcare…' }))}
                    {!project && field('Project', 'project', (
                        <ClientProjectSelect id="client-project" cp={cp} value={form.project}
                            onChange={(p) => setForm((f) => ({ ...f, project: p }))} />
                    ), true)}
                    {field('Status', 'status', (
                        <select id="client-status" value={form.status} onChange={set('status')} className="easy-inp">
                            {CLIENT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                    ))}
                    {profile && field('Client since', 'client_since', text('client_since', { type: 'date', max: todayIso() }))}
                    {field('Email', 'clientEmail', text('clientEmail', { type: 'email' }))}
                    {field('Phone', 'contactPhone', text('contactPhone', { type: 'tel' }))}
                    {profile && field('Alternate contact', 'alt_contact', text('alt_contact', { placeholder: 'Email or phone' }))}
                    {profile && field('Website', 'website', text('website', { placeholder: 'example.com' }))}
                    {field('Address', 'clientAddress', text('clientAddress'), true)}
                    {field('GSTIN', 'buyerGSTIN', (
                        <input id="client-buyerGSTIN" type="text" value={form.buyerGSTIN}
                            onChange={(e) => setForm((f) => ({ ...f, buyerGSTIN: e.target.value.toUpperCase() }))}
                            className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                    ))}
                    {field('State', 'buyerState', text('buyerState'))}
                    {field('Country', 'country_code', (
                        <CountrySelect ariaLabel="Country" value={form.country_code} placeholder=""
                            onChange={(code) => setForm((f) => ({ ...f, country_code: code, contactPhone: withDialCode(f.contactPhone, f.country_code, code) }))} />
                    ))}
                    {profile && (
                        <div className="easy-field full">
                            <ContactsEditor contacts={form.contacts} onChange={(contacts) => setForm((f) => ({ ...f, contacts }))} />
                        </div>
                    )}
                    {field('Note', 'notes', (
                        <textarea id="client-notes" rows={3} value={form.notes} onChange={set('notes')} className="easy-inp" style={{ resize: 'none' }} />
                    ), true)}
                </div>
                <div className="prod-modal-foot">
                    <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
                    <button type="submit" disabled={saving} className="prod-btn-primary">
                        {saving ? 'Saving...' : client ? 'Update Client' : 'Add Client'}
                    </button>
                </div>
            </form>
        </Modal>,
        document.body,
    );
}
