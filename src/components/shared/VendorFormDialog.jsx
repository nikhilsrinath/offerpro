import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { Modal } from '../financial/financeUi';
import { useSection } from '../financial/financeHooks';
import { orgStore } from '../../services/orgStore';
import { useToast } from './Toast';
import { useProfileColumns } from './useProfileColumns';
import BelongsToSelect, { ProjectOnlySelect } from './BelongsToSelect';
import { GENERAL, splitChoice, vendorChoice, vendorProjectIds, saveWithBelongsTo, projectChoices, syncVendorProjects } from '../../services/belongsTo';
import { validate, isEmail, isPhone, isUrl, isIfsc, isSwift, contactErrors } from '../../services/projectWorkspace';
import { recordCurrency } from '../../shared/currency.js';
import { LogoField, ContactsEditor } from '../projects/parties/partyUi';

/* The one Add / Edit Vendor panel. Finance › Vendors, a project's Vendor
   Directory and the vendor dropdown's Add Vendor all open this, so a vendor
   is made the same way wherever it is made.

   `project` puts it inside that project: no Belongs to, a Scope on this
   project, and a new vendor is put on the project. Without it, Belongs to
   says where the vendor sits (General, Internal or projects).

   The profile fields from 0074 (logo, status, website, contract, bank
   details, contact persons) show only when the database has them. Bank
   details also need the Vendor bank details permission. `onSaved(vendor)`
   gets the saved row. */

const TERMS = [0, 7, 15, 30, 45, 60, 90];
const GSTIN_RE = /^[0-9A-Z]{15}$/;

const RULES = {
    gstin: [{ test: (v) => GSTIN_RE.test(String(v).trim().toUpperCase()), message: 'GSTIN must be 15 letters and digits.' }],
    email: [{ test: isEmail, message: 'That email does not look right.' }],
    phone: [{ test: isPhone, message: 'Use 7–15 digits for the phone, with + ( ) - allowed.' }],
};
const PROFILE_RULES = {
    website: [{ test: isUrl, message: 'That website does not look right.' }],
    contract_value: [{ test: (v) => Number(v) >= 0 && Number.isFinite(Number(v)), message: 'The contract value is a positive amount.' }],
    contract_end: [{ test: (v, f) => !f.contract_start || v >= f.contract_start, message: 'The contract ends before it starts.' }],
};
const BANK_RULES = {
    account_number: [{ test: (v) => /^[0-9A-Za-z]{6,34}$/.test(String(v).replace(/\s/g, '')), message: 'The account number is 6–34 letters or digits.' }],
    ifsc: [{ test: isIfsc, message: 'An IFSC looks like HDFC0001234.' }],
    swift: [{ test: isSwift, message: 'A SWIFT code is 8 or 11 characters.' }],
};

const PROFILE = ['logo_path', 'status', 'website', 'contract_start', 'contract_end', 'contract_value', 'contacts'];
const BANK = ['account_name', 'account_number', 'bank_name', 'ifsc', 'swift'];

export default function VendorFormDialog({ vendor = null, project = null, initialName = '', defaultBelongs = GENERAL, onClose, onSaved }) {
    const toast = useToast();
    const links = useSection('project_vendors');
    const profile = useProfileColumns('vendors');
    const canBank = !!profile && orgStore.can('vendor_banking', 'view');
    const banks = useSection('vendor_bank_accounts');
    const bank = vendor && canBank ? banks.find((b) => b.vendor_id === vendor.id) : null;
    const bankEditable = canBank && orgStore.can('vendor_banking', bank ? 'edit' : 'create');
    // A project's vendor carries its link to that project (scope of work).
    const link = vendor && project ? vendor._link || links.find((l) => l.project_id === project.id && l.vendor_id === vendor.id) : null;

    const [form, setForm] = useState(() => ({
        company_name: vendor?.company_name || initialName, contact_name: vendor?.contact_name || '',
        category: vendor?.category || '', email: vendor?.email || '', phone: vendor?.phone || '',
        gstin: vendor?.gstin || '', state: vendor?.state || '', address: vendor?.address || '',
        payment_terms_days: vendor?.payment_terms_days ?? 0, notes: vendor?.notes || '',
        // The Belongs to dropdown: GENERAL, INTERNAL or a project id; `more` are
        // the further projects the vendor is on (the rows "Add" puts under it).
        belongs: vendor ? vendorChoice(vendor, links) : defaultBelongs,
        more: vendor ? vendorProjectIds(vendor.id, links).slice(1) : [],
        logo_path: vendor?.logo_path || null, status: vendor?.status || 'active', website: vendor?.website || '',
        contract_start: vendor?.contract_start || '', contract_end: vendor?.contract_end || '',
        contract_value: vendor?.contract_value ?? '', contacts: vendor?.contacts || [],
        scope: link?.scope || '',
        account_name: bank?.account_name || '', account_number: bank?.account_number || '', bank_name: bank?.bank_name || '',
        ifsc: bank?.ifsc || '', swift: bank?.swift || '',
    }));
    const [problems, setProblems] = useState([]);
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const bind = (k) => ({ value: form[k] ?? '', onChange: (e) => set(k, e.target.value) });

    const save = async (e) => {
        e.preventDefault();
        // Opened from inside another form (a bill): its submit is not ours.
        e.stopPropagation();
        const errs = validate(form, { ...RULES, ...(profile ? PROFILE_RULES : {}), ...(bankEditable ? BANK_RULES : {}) });
        const list = [
            ...(!form.company_name.trim() ? ['Company name is required.'] : []),
            ...Object.values(errs),
            ...(profile ? contactErrors(form.contacts) : []),
        ];
        setProblems(list);
        if (list.length) return;

        const { belongs, more, scope, ...rest } = form;
        BANK.forEach((k) => delete rest[k]);
        if (!profile) PROFILE.forEach((k) => delete rest[k]);
        const data = { ...rest, company_name: form.company_name.trim(), gstin: form.gstin.trim().toUpperCase() };
        if (!project) data.belongs_to = splitChoice(belongs).belongs_to;
        setSaving(true);
        try {
            const write = (d) => (vendor ? orgStore.updateItem('vendors', vendor.id, d) : orgStore.addItem('vendors', d));
            const { result, skipped } = await saveWithBelongsTo(write, data, ['belongs_to']);
            const id = vendor?.id || result?.id;

            let linkFailed = false;
            try {
                if (project && !vendor) await orgStore.addItem('project_vendors', { project_id: project.id, vendor_id: id, scope });
                else if (project && link && scope !== (link.scope || '')) await orgStore.updateItem('project_vendors', link.id, { scope });
                // Every project chosen, the first row and each one added, is
                // linked; projects taken out of the form are unlinked.
                else if (!project && id) await syncVendorProjects(id, projectChoices([belongs, ...(more || [])]), links);
            } catch {
                linkFailed = true;
            }

            const hasBank = BANK.some((k) => form[k]);
            if (bankEditable && id && (hasBank || bank)) {
                const row = { vendor_id: id, account_name: form.account_name, account_number: form.account_number.replace(/\s/g, ''), bank_name: form.bank_name, ifsc: form.ifsc, swift: form.swift };
                if (bank) await orgStore.updateItem('vendor_bank_accounts', bank.id, row);
                else await orgStore.addItem('vendor_bank_accounts', row);
            }

            if (linkFailed) toast("Vendor saved, but it could not be added to the project. Try again from the project's Vendor Directory.", 'error');
            else if (skipped) toast('Vendor saved. Internal / General needs database update 0078 before it is kept.', 'info');
            else toast(vendor ? 'Vendor updated' : project ? 'Vendor added to the project' : 'Vendor added', 'success');
            onSaved?.(orgStore.getSectionAsList('vendors').find((v) => v.id === id) || { ...vendor, ...data, id });
            onClose();
        } catch (err) {
            setProblems([err.message || 'Could not save the vendor.']);
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <Modal title={vendor ? 'Edit Vendor' : 'New Vendor'} onClose={onClose} width="820px">
            <form onSubmit={save} className="prod-modal-body" noValidate>
                {problems.length > 0 && (
                    <div className="prod-form-error" role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>
                )}
                <div className="prod-form-grid">
                    {profile && (
                        <div className="prod-field full">
                            <label>Logo</label>
                            <LogoField kind="vendors" value={form.logo_path} name={form.company_name} onChange={(v) => set('logo_path', v)} />
                        </div>
                    )}
                    <div className="prod-field full">
                        <label className="req" htmlFor="vendor-company">Company name</label>
                        <input id="vendor-company" maxLength={200} {...bind('company_name')} autoFocus required />
                    </div>
                    {!project && (
                        <div className="prod-field full">
                            <label htmlFor="vendor-belongs">Belongs to</label>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <BelongsToSelect id="vendor-belongs" value={form.belongs} onChange={(v) => set('belongs', v)} />
                                </div>
                                <button type="button" className="prod-btn-ghost" onClick={() => set('more', [...(form.more || []), ''])}
                                    aria-label="Add the vendor to another project">
                                    <Plus size={13} aria-hidden="true" /> Add
                                </button>
                            </div>
                            {(form.more || []).map((pid, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <ProjectOnlySelect value={pid} label={`Also on project ${i + 2}`}
                                            exclude={[form.belongs, ...(form.more || [])]}
                                            onChange={(v) => set('more', form.more.map((x, j) => (j === i ? v : x)))} />
                                    </div>
                                    <button type="button" className="prod-btn-ghost" aria-label={`Take project ${i + 2} off`}
                                        onClick={() => set('more', form.more.filter((_, j) => j !== i))}>
                                        <X size={13} aria-hidden="true" /> Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="prod-field">
                        <label htmlFor="vendor-contact">Contact person</label>
                        <input id="vendor-contact" {...bind('contact_name')} />
                    </div>
                    <div className="prod-field">
                        <label htmlFor="vendor-category">Category</label>
                        <input id="vendor-category" {...bind('category')} placeholder="e.g. Hardware, Cloud, Logistics" />
                    </div>
                    {profile && (
                        <div className="prod-field">
                            <label htmlFor="vendor-status">Status</label>
                            <select id="vendor-status" {...bind('status')}>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>
                    )}
                    {profile && (
                        <div className="prod-field">
                            <label htmlFor="vendor-website">Website</label>
                            <input id="vendor-website" {...bind('website')} placeholder="example.com" />
                        </div>
                    )}
                    <div className="prod-field">
                        <label htmlFor="vendor-email">Email</label>
                        <input id="vendor-email" type="email" {...bind('email')} />
                    </div>
                    <div className="prod-field">
                        <label htmlFor="vendor-phone">Phone</label>
                        <input id="vendor-phone" type="tel" {...bind('phone')} />
                    </div>
                    <div className="prod-field">
                        <label htmlFor="vendor-gstin">GSTIN</label>
                        <input id="vendor-gstin" value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} />
                    </div>
                    <div className="prod-field">
                        <label htmlFor="vendor-state">State</label>
                        <input id="vendor-state" {...bind('state')} />
                    </div>
                    <div className="prod-field full">
                        <label htmlFor="vendor-address">Address</label>
                        <textarea id="vendor-address" rows={2} {...bind('address')} />
                    </div>
                    <div className="prod-field full">
                        <label>Payment terms</label>
                        <div className="prod-rate-chips">
                            {TERMS.map((d) => (
                                <button key={d} type="button" aria-pressed={Number(form.payment_terms_days) === d}
                                    className={`easy-chip ${Number(form.payment_terms_days) === d ? 'active' : ''}`} onClick={() => set('payment_terms_days', d)}>
                                    {d === 0 ? 'On receipt' : `Net ${d}`}
                                </button>
                            ))}
                        </div>
                    </div>
                    {profile && (
                        <>
                            <div className="prod-field">
                                <label htmlFor="vendor-cstart">Contract start</label>
                                <input id="vendor-cstart" type="date" {...bind('contract_start')} />
                            </div>
                            <div className="prod-field">
                                <label htmlFor="vendor-cend">Contract end</label>
                                <input id="vendor-cend" type="date" min={form.contract_start || undefined} {...bind('contract_end')} />
                            </div>
                            <div className={`prod-field${project ? '' : ' full'}`}>
                                <label htmlFor="vendor-cvalue">Contract value ({recordCurrency(project?.currency)})</label>
                                <input id="vendor-cvalue" type="number" min="0" step="0.01" {...bind('contract_value')} />
                            </div>
                        </>
                    )}
                    {profile && project && (
                        <div className="prod-field">
                            <label htmlFor="vendor-scope">Scope on this project</label>
                            <input id="vendor-scope" maxLength={500} {...bind('scope')} placeholder="Printing, hosting, site work…" />
                        </div>
                    )}
                    {bankEditable && (
                        <fieldset className="prod-field full" style={{ border: '1px solid var(--border-default)', borderRadius: 9, padding: 12, margin: 0 }}>
                            <legend style={{ fontSize: '0.72rem', fontWeight: 650, color: 'var(--text-secondary)', padding: '0 6px' }}>
                                Bank Details (Visible Only With the Bank Details Permission)
                            </legend>
                            <div className="prod-form-grid">
                                <div className="prod-field"><label htmlFor="vendor-acname">Account name</label><input id="vendor-acname" autoComplete="off" {...bind('account_name')} /></div>
                                <div className="prod-field"><label htmlFor="vendor-acno">Account number</label><input id="vendor-acno" autoComplete="off" inputMode="numeric" {...bind('account_number')} /></div>
                                <div className="prod-field"><label htmlFor="vendor-bank">Bank</label><input id="vendor-bank" {...bind('bank_name')} /></div>
                                <div className="prod-field"><label htmlFor="vendor-ifsc">IFSC</label><input id="vendor-ifsc" style={{ textTransform: 'uppercase' }} {...bind('ifsc')} /></div>
                                <div className="prod-field"><label htmlFor="vendor-swift">SWIFT (for payments abroad)</label><input id="vendor-swift" style={{ textTransform: 'uppercase' }} {...bind('swift')} /></div>
                            </div>
                        </fieldset>
                    )}
                    {profile && (
                        <div className="prod-field full">
                            <ContactsEditor contacts={form.contacts} onChange={(contacts) => set('contacts', contacts)} />
                        </div>
                    )}
                    <div className="prod-field full">
                        <label htmlFor="vendor-notes">Notes</label>
                        <textarea id="vendor-notes" rows={2} {...bind('notes')} />
                    </div>
                </div>
                <div className="prod-modal-foot">
                    <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
                    <button type="submit" disabled={saving} className="prod-btn-primary">
                        {saving ? 'Saving...' : vendor ? 'Save Changes' : 'Add Vendor'}
                    </button>
                </div>
            </form>
        </Modal>,
        document.body,
    );
}
