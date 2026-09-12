import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, ArrowRight, ChevronRight, UserCircle, Briefcase,
    Mail, Phone, Calendar, MapPin, DollarSign, FileText, Users,
    CheckCircle, Zap, Hash, Building, Link2, Camera, Trash2
} from 'lucide-react';
import { storageService } from '../services/storageService';
import { uploadOrgImage } from '../services/imageUploadService';
import EmployeeAvatar from './shared/EmployeeAvatar';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

const STEPS = [
    { id: 1, label: 'Type', icon: Users },
    { id: 2, label: 'Personal', icon: UserCircle },
    { id: 3, label: 'Role', icon: Briefcase },
    { id: 4, label: 'Compensation', icon: DollarSign },
];

export default function EmployeeForm({ onBack, onSuccess, employee }) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const org = activeOrg || {};
    const isEditMode = !!employee;

    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const photoInputRef = useRef(null);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [photoError, setPhotoError] = useState('');

    const [formData, setFormData] = useState(() => {
        // If editing, pre-fill with employee data
        if (employee) {
            return {
                offerType: employee.offerType || 'fulltime',
                studentName: employee.studentName || employee.first_name || '',
                photo_path: employee.photo_path || null,
                email: employee.email || '',
                phone: employee.phone || '',
                studentAddress: employee.studentAddress || '',
                role: employee.role || '',
                department: employee.department || '',
                supervisorName: employee.supervisorName || '',
                responsibilities: employee.responsibilities || '',
                startDate: employee.startDate || '',
                endDate: employee.endDate || '',
                acceptanceDeadline: employee.acceptanceDeadline || '',
                isPaid: employee.isPaid !== false,
                stipend: employee.stipend || employee.salary || '',
                currency: employee.currency || 'INR',
                paymentFrequency: employee.paymentFrequency || 'Monthly',
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
                // Store original employee ID for updates
                id: employee.id,
            };
        }
        // Default for new employee
        return {
            offerType: 'fulltime',
            studentName: '',
            photo_path: null,
            email: '',
            phone: '',
            studentAddress: '',
            role: '',
            department: '',
            supervisorName: '',
            responsibilities: '',
            startDate: '',
            endDate: '',
            acceptanceDeadline: '',
            isPaid: true,
            stipend: '',
            currency: 'INR',
            paymentFrequency: 'Monthly',
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
            showStamp: true
        };
    });

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

    const canProceed = () => {
        if (step === 1) return true;
        if (step === 2) return formData.studentName && formData.email && formData.phone;
        if (step === 3) return formData.role && formData.department && formData.startDate;
        return true;
    };

    const handleNext = () => {
        if (step < 4 && canProceed()) setStep(step + 1);
    };

    const handleBack = () => {
        if (step > 1) setStep(step - 1);
    };

    // Uploaded straight away rather than held until save: processImage() resizes
    // and re-encodes, and doing that during a multi-step submit would stall the
    // whole form on an operation that can fail on its own.
    const handlePhoto = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setPhotoBusy(true);
        setPhotoError('');
        try {
            const { path } = await uploadOrgImage({
                orgId: activeOrg?.id, kind: 'employeePhoto', source: file,
            });
            setFormData((f) => ({ ...f, photo_path: path }));
        } catch (err) {
            setPhotoError(err.message || 'Could not upload that photo.');
        } finally {
            setPhotoBusy(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            if (isEditMode) {
                // Update existing employee
                await storageService.updateEmployee(formData.id, formData, activeOrg?.id);
            } else {
                // Create new employee. Onboarding from this page is direct:
                // the person joins the registry immediately and the offer
                // letter is generated as a record they can download. It is not
                // a portal offer awaiting a signature, so it is filed as
                // already accepted and linked to the employee — that keeps it
                // out of the Offer Tracker's pending list and stops the
                // acceptance sync from creating the same person twice.
                const savedEmployee = await storageService.saveEmployee(formData, activeOrg?.id);
                await storageService.save(
                    { ...formData, source: 'employee_form', employee_synced: true },
                    'offer', activeOrg?.id, user?.id,
                    // savedEmployee, not the `employee` prop: this branch only runs
                    // when creating someone, so the prop is undefined here and the
                    // record would be filed with no employee_id — leaving the offer
                    // unlinked and the person eligible to be onboarded twice. The
                    // previous name for this const was `employee`, which shadowed
                    // the prop and made the right value reachable by accident.
                    { status: 'accepted', employee_id: savedEmployee?.id || employee?.id || null },
                );
            }
            setShowSuccess(true);
            setTimeout(() => {
                setIsSubmitting(false);
                if (onSuccess) {
                    onSuccess();
                } else {
                    navigate('/employees');
                }
            }, 1500);
        } catch (err) {
            console.error(err);
            alert(isEditMode ? "Error updating employee: " + err.message : "Error adding employee: " + err.message);
            setIsSubmitting(false);
        }
    };

    if (showSuccess) {
        return (
            <div className="empf-success animate-in">
                <div className="empf-success-icon">
                    <CheckCircle size={48} />
                </div>
                <h2>{isEditMode ? 'Profile Updated' : 'Employee Onboarded'}</h2>
                <p>{isEditMode ? 'Your employee profile has been successfully updated.' : 'Offer letter has been auto-generated and saved to records.'}</p>
            </div>
        );
    }

    return (
        <div className="animate-in" style={{ maxWidth: '720px', margin: '0 auto' }}>
            {/* Back button */}
            <button onClick={() => isEditMode && onBack ? onBack() : navigate('/employees')} className="empf-back-btn">
                <ArrowLeft size={16} /> {isEditMode ? 'Back to Profile' : 'Back to Registry'}
            </button>

            {/* Stepper */}
            <div className="empf-stepper">
                {STEPS.map((s, i) => {
                    const Icon = s.icon;
                    const isActive = step === s.id;
                    const isDone = step > s.id;
                    return (
                        <div key={s.id} className="empf-step-wrapper">
                            {i > 0 && <div className={`empf-step-line ${isDone ? 'done' : ''}`} />}
                            <button
                                type="button"
                                className={`empf-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                                onClick={() => { if (isDone || isActive) setStep(s.id); }}
                            >
                                <div className="empf-step-circle">
                                    {isDone ? <CheckCircle size={16} /> : <Icon size={16} />}
                                </div>
                                <span className="empf-step-label">{s.label}</span>
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Form Card */}
            <form onSubmit={handleSubmit}>
                <div className="empf-card">

                    {/* Step 1: Employee Type */}
                    {step === 1 && (
                        <div className="empf-section animate-in">
                            <div className="empf-section-header">
                                <h3>Employment Type</h3>
                                <p>Select the type of employment for the new team member.</p>
                            </div>
                            <div className="empf-type-grid">
                                {[
                                    { id: 'fulltime', label: 'Full-Time Employee', desc: 'Permanent position with full benefits and salary', icon: Briefcase, color: '#10b981' },
                                    { id: 'internship', label: 'Intern', desc: 'Fixed-term internship with stipend compensation', icon: Calendar, color: '#f59e0b' },
                                    { id: 'collaboration', label: 'Collaborator', desc: 'Fixed-term collaboration for a defined project or scope', icon: Link2, color: '#0d9488' },
                                ].map(t => {
                                    const TIcon = t.icon;
                                    return (
                                        <button key={t.id} type="button"
                                            className={`empf-type-card ${formData.offerType === t.id ? 'selected' : ''}`}
                                            onClick={() => set('offerType', t.id)}
                                        >
                                            <div className="empf-type-icon" style={{ background: `${t.color}12`, color: t.color }}>
                                                <TIcon size={24} />
                                            </div>
                                            <div className="empf-type-text">
                                                <span className="empf-type-title">{t.label}</span>
                                                <span className="empf-type-desc">{t.desc}</span>
                                            </div>
                                            <div className={`empf-type-radio ${formData.offerType === t.id ? 'checked' : ''}`} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Step 2: Personal Information */}
                    {step === 2 && (
                        <div className="empf-section animate-in">
                            <div className="empf-section-header">
                                <h3>Personal Information</h3>
                                <p>Enter the employee's personal and contact details.</p>
                            </div>
                            <div className="empf-fields">
                                <div className="empf-field">
                                    <label className="empf-label">Photo</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <EmployeeAvatar name={formData.studentName} photoPath={formData.photo_path} size={56} />
                                        <input ref={photoInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto} hidden />
                                        <button type="button" className="prod-btn-ghost" onClick={() => photoInputRef.current?.click()} disabled={photoBusy}>
                                            <Camera size={14} /> {photoBusy ? 'Uploading…' : formData.photo_path ? 'Replace' : 'Add photo'}
                                        </button>
                                        {formData.photo_path && (
                                            <button type="button" className="prod-btn-ghost" onClick={() => setFormData((f) => ({ ...f, photo_path: null }))}>
                                                <Trash2 size={14} /> Remove
                                            </button>
                                        )}
                                    </div>
                                    <div className="prod-field-note">
                                        PNG, JPEG or WebP. Resized automatically and stored privately, so it is
                                        only visible to people who can see the team.
                                    </div>
                                    {photoError && <div className="prod-form-error">{photoError}</div>}
                                </div>
                                <div className="empf-field">
                                    <label className="empf-label">Full Name</label>
                                    <div className="empf-input-wrap">
                                        <UserCircle size={16} className="empf-input-icon" />
                                        <input name="studentName" value={formData.studentName} onChange={handleChange} required placeholder="e.g. Rahul Sharma" className="empf-input" />
                                    </div>
                                </div>
                                <div className="empf-row-2">
                                    <div className="empf-field">
                                        <label className="empf-label">Email Address</label>
                                        <div className="empf-input-wrap">
                                            <Mail size={16} className="empf-input-icon" />
                                            <input type="email" name="email" value={formData.email} onChange={handleChange} required placeholder="rahul@example.com" className="empf-input" />
                                        </div>
                                    </div>
                                    <div className="empf-field">
                                        <label className="empf-label">Phone Number</label>
                                        <div className="empf-input-wrap">
                                            <Phone size={16} className="empf-input-icon" />
                                            <input name="phone" value={formData.phone} onChange={handleChange} required placeholder="+91 98765 43210" className="empf-input" />
                                        </div>
                                    </div>
                                </div>
                                <div className="empf-field">
                                    <label className="empf-label">Home Address</label>
                                    <div className="empf-input-wrap">
                                        <MapPin size={16} className="empf-input-icon" />
                                        <input name="studentAddress" value={formData.studentAddress} onChange={handleChange} required placeholder="Street, City, State, PIN" className="empf-input" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Role & Dates */}
                    {step === 3 && (
                        <div className="empf-section animate-in">
                            <div className="empf-section-header">
                                <h3>Role & Work Details</h3>
                                <p>Define their position, department, and key dates.</p>
                            </div>
                            <div className="empf-fields">
                                <div className="empf-row-2">
                                    <div className="empf-field">
                                        <label className="empf-label">Job Title</label>
                                        <div className="empf-input-wrap">
                                            <Briefcase size={16} className="empf-input-icon" />
                                            <input name="role" value={formData.role} onChange={handleChange} required placeholder="e.g. Frontend Developer" className="empf-input" />
                                        </div>
                                    </div>
                                    <div className="empf-field">
                                        <label className="empf-label">Department</label>
                                        <div className="empf-input-wrap">
                                            <Building size={16} className="empf-input-icon" />
                                            <input name="department" value={formData.department} onChange={handleChange} required placeholder="e.g. Engineering" className="empf-input" />
                                        </div>
                                    </div>
                                </div>
                                <div className="empf-field">
                                    <label className="empf-label">Reporting Manager</label>
                                    <div className="empf-input-wrap">
                                        <Users size={16} className="empf-input-icon" />
                                        <input name="supervisorName" value={formData.supervisorName} onChange={handleChange} required placeholder="Manager's full name" className="empf-input" />
                                    </div>
                                </div>
                                <div className={`empf-row-${(formData.offerType === 'internship' || formData.offerType === 'collaboration') ? '3' : '2'}`}>
                                    <div className="empf-field">
                                        <label className="empf-label">Joining Date</label>
                                        <div className="empf-input-wrap">
                                            <Calendar size={16} className="empf-input-icon" />
                                            <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} required className="empf-input" />
                                        </div>
                                    </div>
                                    {(formData.offerType === 'internship' || formData.offerType === 'collaboration') && (
                                        <div className="empf-field">
                                            <label className="empf-label">End Date</label>
                                            <div className="empf-input-wrap">
                                                <Calendar size={16} className="empf-input-icon" />
                                                <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} required className="empf-input" />
                                            </div>
                                        </div>
                                    )}
                                    <div className="empf-field">
                                        <label className="empf-label">Offer Deadline</label>
                                        <div className="empf-input-wrap">
                                            <Calendar size={16} className="empf-input-icon" />
                                            <input type="date" name="acceptanceDeadline" value={formData.acceptanceDeadline} onChange={handleChange} required className="empf-input" />
                                        </div>
                                    </div>
                                </div>
                                <div className="empf-field">
                                    <label className="empf-label">Key Responsibilities</label>
                                    <div className="empf-input-wrap textarea">
                                        <FileText size={16} className="empf-input-icon" />
                                        <textarea name="responsibilities" value={formData.responsibilities} onChange={handleChange} required placeholder="Describe key tasks and responsibilities..." rows={3} className="empf-input empf-textarea" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 4: Compensation */}
                    {step === 4 && (
                        <div className="empf-section animate-in">
                            <div className="empf-section-header">
                                <h3>Compensation</h3>
                                <p>Set the {formData.offerType === 'internship' ? 'stipend' : formData.offerType === 'collaboration' ? 'collaboration fee' : 'salary'} and payment details.</p>
                            </div>
                            <div className="empf-fields">
                                <div className="empf-row-2">
                                    <div className="empf-field">
                                        <label className="empf-label">{formData.offerType === 'internship' ? 'Monthly Stipend' : formData.offerType === 'collaboration' ? 'Collaboration Fee' : 'Annual Salary (CTC)'}</label>
                                        <div className="empf-input-wrap">
                                            <DollarSign size={16} className="empf-input-icon" />
                                            <input type="number" name="stipend" value={formData.stipend} onChange={handleChange} required placeholder="0.00" className="empf-input" />
                                        </div>
                                    </div>
                                    <div className="empf-field">
                                        <label className="empf-label">Currency</label>
                                        <div className="empf-input-wrap">
                                            <Hash size={16} className="empf-input-icon" />
                                            <select name="currency" value={formData.currency} onChange={handleChange} className="empf-input empf-select">
                                                <option value="INR">INR - Indian Rupee</option>
                                                <option value="USD">USD - US Dollar</option>
                                                <option value="EUR">EUR - Euro</option>
                                                <option value="GBP">GBP - British Pound</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="empf-field">
                                    <label className="empf-label">Payment Frequency</label>
                                    <div className="empf-freq-options">
                                        {['Monthly', 'Bi-Weekly', 'Weekly'].map(freq => (
                                            <button key={freq} type="button"
                                                className={`empf-freq-btn ${formData.paymentFrequency === freq ? 'active' : ''}`}
                                                onClick={() => set('paymentFrequency', freq)}
                                            >
                                                {freq}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Summary Preview */}
                                <div className="empf-preview">
                                    <div className="empf-preview-title">
                                        <Zap size={14} /> Onboarding Summary
                                    </div>
                                    <div className="empf-preview-grid">
                                        <div className="empf-preview-item">
                                            <span className="empf-preview-label">Name</span>
                                            <span className="empf-preview-value">{formData.studentName || '—'}</span>
                                        </div>
                                        <div className="empf-preview-item">
                                            <span className="empf-preview-label">Role</span>
                                            <span className="empf-preview-value">{formData.role || '—'}</span>
                                        </div>
                                        <div className="empf-preview-item">
                                            <span className="empf-preview-label">Department</span>
                                            <span className="empf-preview-value">{formData.department || '—'}</span>
                                        </div>
                                        <div className="empf-preview-item">
                                            <span className="empf-preview-label">Type</span>
                                            <span className="empf-preview-value">{formData.offerType === 'fulltime' ? 'Full-Time' : formData.offerType === 'collaboration' ? 'Collaborator' : 'Intern'}</span>
                                        </div>
                                        <div className="empf-preview-item">
                                            <span className="empf-preview-label">{formData.offerType === 'internship' ? 'Stipend' : formData.offerType === 'collaboration' ? 'Collab Fee' : 'CTC'}</span>
                                            <span className="empf-preview-value">{formData.currency} {Number(formData.stipend || 0).toLocaleString()}</span>
                                        </div>
                                        <div className="empf-preview-item">
                                            <span className="empf-preview-label">Joining</span>
                                            <span className="empf-preview-value">{formData.startDate ? new Date(formData.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Navigation Footer */}
                    <div className="empf-footer">
                        {step > 1 ? (
                            <button type="button" className="empf-btn-secondary" onClick={handleBack}>
                                <ArrowLeft size={16} /> Previous
                            </button>
                        ) : <div />}

                        {step < 4 ? (
                            <button type="button" className="empf-btn-primary" onClick={handleNext} disabled={!canProceed()}>
                                Next <ArrowRight size={16} />
                            </button>
                        ) : (
                            <button type="submit" className="empf-btn-submit" disabled={isSubmitting}>
                                {isSubmitting 
                                    ? (isEditMode ? 'Saving...' : 'Onboarding...') 
                                    : (isEditMode ? 'Save Changes' : 'Onboard & Generate Offer')}
                                {!isSubmitting && <ChevronRight size={18} />}
                            </button>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}
