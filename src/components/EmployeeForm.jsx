import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from './shell/navHistory';
import { storageService } from '../services/storageService';
import { uploadOrgImage } from '../services/imageUploadService';
import EmployeeAvatar from './shared/EmployeeAvatar';
import DepartmentsPanel from './people/DepartmentsPanel';
import { departmentRows } from './people/departments';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { orgStore } from '../services/orgStore';
import {
    Page, Toolbar, Panel, Row, Grid, Btn, Seg, Field, Input, Select, Textarea, Empty,
} from './ui/edge';
import { useT } from './ui/edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   Add or edit a person.

   This was a four-step wizard over twelve fields, which meant three clicks of
   navigation to fill in a form that fits on one screen. It is now one page in
   three labelled sections, with the save button in the toolbar where it stays
   visible. Nothing is hidden behind a step, so you can fill the fields in
   whatever order you have the answers.
   ══════════════════════════════════════════════════════════════════════════ */

const TYPES = [
    { id: 'fulltime', label: 'Full-time' },
    { id: 'parttime', label: 'Part-time' },
    { id: 'internship', label: 'Internship' },
    { id: 'collaboration', label: 'Collaboration' },
];

const blank = (org) => ({
    offerType: 'fulltime',
    studentName: '', photo_path: null, email: '', phone: '', studentAddress: '',
    role: '', department: '', supervisorName: '', responsibilities: '',
    startDate: '', endDate: '', acceptanceDeadline: '',
    isPaid: true, stipend: '', currency: 'INR', paymentFrequency: 'Monthly',
    companyName: org.company_name || '',
    companyTagline: org.company_tagline || '',
    companyAddress: org.company_address || '',
    companyLogo: org.logo_url || null,
    cin: org.cin || '',
    companyWebsite: org.company_website || '',
    authorizedPersonName: org.owner_full_name || '',
    authorizedPersonDesignation: org.document_designation || '',
    contactEmail: org.company_email || '',
    contactPhone: org.company_phone || '',
    signature: org.signature_url || null,
    stampType: org.stamp_type || 'generated',
    stampCity: org.stamp_city || '',
    showStamp: true,
});

export default function EmployeeForm({ onBack, onSuccess, employee }) {
    const t = useT();
    const navigate = useNavigate();
    const goBack = useGoBack();
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const org = activeOrg || {};
    const isEdit = !!employee;

    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);
    const [depts, setDepts] = useState([]);
    const [showDepts, setShowDepts] = useState(false);
    const photoInput = useRef(null);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [photoError, setPhotoError] = useState('');

    const [form, setForm] = useState(() => (employee
        ? { ...blank(org), ...employee, studentName: employee.studentName || employee.first_name || '', id: employee.id }
        : blank(org)));

    const loadDepts = useCallback(() => {
        if (!activeOrg?.id) return Promise.resolve();
        return storageService.getDepartments(activeOrg.id)
            .then((d) => setDepts(d))
            .catch(() => setDepts([]));
    }, [activeOrg?.id]);
    useEffect(() => { loadDepts(); }, [loadDepts]);

    // Head-counts for the departments panel come from the people already on
    // the registry, the same figures the Employees page shows.
    const people = useMemo(() => (showDepts ? orgStore.getSectionAsList('employees') : []), [showDepts]);
    const deptRows = useMemo(() => departmentRows(people, depts), [people, depts]);
    const deptNames = useMemo(() => [...new Set(depts.map((d) => d.name))].sort(), [depts]);

    const set = (field) => (e) => setForm((p) => ({
        ...p, [field]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e,
    }));

    // The saved department_id outranks the name when the row is written, so a
    // new pick has to drop it or the edit keeps the old department.
    const setDepartment = (e) => setForm((p) => ({ ...p, department: e.target.value, department_id: undefined }));
    const pickDepartment = (name) => setForm((p) => ({ ...p, department: name, department_id: undefined }));

    const dated = form.offerType === 'internship' || form.offerType === 'collaboration';
    // A new hire needs all four; an edit only needs a name, so records made
    // without an email or start date (the founder's, from sign-up) can still
    // be saved.
    const missing = [
        ['Name', form.studentName],
        ...(isEdit ? [] : [['email', form.email], ['job title', form.role], ['start date', form.startDate]]),
    ].filter(([, v]) => !String(v ?? '').trim()).map(([label]) => label);
    const ready = missing.length === 0;

    // Uploaded straight away rather than held until save: processImage() resizes
    // and re-encodes, and doing that during submit would stall the whole form
    // on an operation that can fail on its own.
    const onPhoto = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setPhotoBusy(true); setPhotoError('');
        try {
            const { path } = await uploadOrgImage({ orgId: activeOrg?.id, kind: 'employeePhoto', source: file });
            setForm((f) => ({ ...f, photo_path: path }));
        } catch (err) {
            setPhotoError(err.message || 'Could not upload that photo.');
        } finally {
            setPhotoBusy(false);
        }
    };

    const submit = async () => {
        // Someone the registry already holds is not added a second time.
        if (!isEdit && form.email.trim()) {
            const email = form.email.trim().toLowerCase();
            const same = [...orgStore.getSectionAsList('employees'), ...orgStore.getSectionAsList('ex_employees')]
                .find((e) => (e.email || '').toLowerCase() === email);
            if (same) {
                alert(`${same.studentName || 'Someone'} is already in the registry${same.exited_at ? ' as an ex-employee' : ''} with the email ${form.email.trim()}.`);
                return;
            }
        }
        setSaving(true);
        try {
            if (isEdit) {
                await storageService.updateEmployee(form.id, form, activeOrg?.id);
            } else {
                // Onboarding from this page is direct: the person joins the
                // registry immediately and the offer letter is filed as a
                // record they can download. It is not a portal offer awaiting a
                // signature, so it is stored as already accepted and linked to
                // the employee: that keeps it out of the Recruitment Tracker's
                // pending list and stops the acceptance sync creating the same
                // person twice.
                const saved = await storageService.saveEmployee(form, activeOrg?.id);
                await storageService.save(
                    { ...form, source: 'employee_form', employee_synced: true },
                    'offer', activeOrg?.id, user?.id,
                    { status: 'accepted', employee_id: saved?.id || employee?.id || null },
                );
            }
            setDone(true);
            setTimeout(() => {
                setSaving(false);
                if (onSuccess) onSuccess();
                else navigate('/employees');
            }, 900);
        } catch (err) {
            console.error(err);
            alert((isEdit ? 'Error updating employee: ' : 'Error adding employee: ') + err.message);
            setSaving(false);
        }
    };

    // Cancel returns to the page the form was opened from.
    const leave = () => { if (onBack) onBack(); else goBack('/employees'); };

    if (done) {
        return (
            <Page>
                <Panel>
                    <Empty>
                        {form.studentName} {isEdit ? 'has been updated.' : 'is on the team.'}
                        <br />Taking you back to the registry…
                    </Empty>
                </Panel>
            </Page>
        );
    }

    return (
        <Page>
            <Toolbar right={
                <Row gap={8}>
                    <Btn onClick={leave}>Cancel</Btn>
                    <Btn primary onClick={submit} disabled={saving || !ready}>
                        {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to the team'}
                    </Btn>
                </Row>
            }>
                <span style={{ fontSize: 13.5, color: t.text }}>
                    {isEdit ? 'Editing ' + (form.studentName || 'employee') : 'New employee'}
                </span>
            </Toolbar>

            <div style={{ display: 'grid', gap: 14 }}>
                <Panel title="Person" pad={15}>
                    <Row gap={15} align="flex-start" wrap>
                        <div style={{ textAlign: 'center' }}>
                            <EmployeeAvatar name={form.studentName} photoPath={form.photo_path} size={64} />
                            <div style={{ marginTop: 9 }}>
                                <Btn size="sm" onClick={() => photoInput.current?.click()} disabled={photoBusy}>
                                    {photoBusy ? 'Uploading…' : form.photo_path ? 'Replace' : 'Add photo'}
                                </Btn>
                            </div>
                            <input ref={photoInput} type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
                            {photoError && <div style={{ fontSize: 11, color: t.down, marginTop: 6, maxWidth: 120 }}>{photoError}</div>}
                        </div>

                        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                            <Grid min={200} gap={13}>
                                <Field label="Employee ID">
                                    <Input value={form.employee_code || ''} disabled placeholder={isEdit ? '' : 'Generated when they are added'} aria-label="Employee ID" />
                                </Field>
                                <Field required label="Full name"><Input value={form.studentName} onChange={set('studentName')} /></Field>
                                <Field required={!isEdit} label="Email">
                                    <Input type="email" value={form.email} onChange={set('email')} />
                                </Field>
                                <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
                                <Field label="Work location">
                                    <Input value={form.location || ''} onChange={set('location')} placeholder="City, office or Remote" />
                                </Field>
                                <Field label="Address" wide>
                                    <Input value={form.studentAddress} onChange={set('studentAddress')} />
                                </Field>
                            </Grid>
                        </div>
                    </Row>
                </Panel>

                <Panel title="Role" pad={15}>
                    <Field label="Employment type">
                        <Seg value={form.offerType} onChange={set('offerType')} options={TYPES} />
                    </Field>
                    <div style={{ height: 13 }} />
                    <Grid min={200} gap={13}>
                        <Field required={!isEdit} label="Job title"><Input value={form.role} onChange={set('role')} /></Field>
                        <Row gap={8} align="flex-end" wrap>
                            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                <Field label="Department">
                                    <Select value={form.department} onChange={setDepartment}>
                                        <option value="">None</option>
                                        {deptNames.map((d) => <option key={d} value={d}>{d}</option>)}
                                        {form.department && !deptNames.includes(form.department) && (
                                            <option value={form.department}>{form.department}</option>
                                        )}
                                    </Select>
                                </Field>
                            </div>
                            <Btn onClick={() => setShowDepts((v) => !v)} aria-expanded={showDepts}>
                                {showDepts ? 'Close' : 'Add new department'}
                            </Btn>
                        </Row>
                        {showDepts && (
                            <div style={{ gridColumn: '1 / -1', maxWidth: 340 }}>
                                <DepartmentsPanel rows={deptRows} total={people.length} orgId={activeOrg?.id}
                                    onChanged={loadDepts} active={form.department}
                                    onPick={pickDepartment}
                                    onAdded={(name) => { pickDepartment(name); setShowDepts(false); }} />
                            </div>
                        )}
                        <Field label="Reports to"><Input value={form.supervisorName} onChange={set('supervisorName')} /></Field>
                        <Field required={!isEdit} label="Start date"><Input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
                        {dated && <Field label="End date"><Input type="date" value={form.endDate} onChange={set('endDate')} /></Field>}
                        <Field label="Responsibilities" wide>
                            <Textarea value={form.responsibilities} onChange={set('responsibilities')} />
                        </Field>
                    </Grid>
                </Panel>

                <Panel title="Pay" pad={15}>
                    <Field label="Paid">
                        <Seg value={form.isPaid ? 'paid' : 'unpaid'}
                            onChange={(v) => setForm((p) => ({ ...p, isPaid: v === 'paid' }))}
                            options={[{ id: 'paid', label: 'Paid' }, { id: 'unpaid', label: 'Unpaid' }]} />
                    </Field>
                    {form.isPaid && (
                        <>
                            <div style={{ height: 13 }} />
                            <Grid min={150} gap={13}>
                                <Field label="Amount"><Input type="number" value={form.stipend} onChange={set('stipend')} placeholder="0" /></Field>
                                <Field label="Currency">
                                    <Select value={form.currency} onChange={set('currency')}>
                                        <option value="INR">INR</option><option value="USD">USD</option><option value="EUR">EUR</option>
                                    </Select>
                                </Field>
                                <Field label="Paid">
                                    <Select value={form.paymentFrequency} onChange={set('paymentFrequency')}>
                                        <option value="Monthly">Monthly</option>
                                        <option value="Yearly">Yearly</option>
                                        <option value="One-time">One-time</option>
                                    </Select>
                                </Field>
                            </Grid>
                        </>
                    )}
                </Panel>
            </div>
        </Page>
    );
}
