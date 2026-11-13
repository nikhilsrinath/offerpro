// What the company and project announcement editors share, apart from their
// fields (announcementFields.jsx): the form's send date, and how a notice's
// audience is put in words on its card.

import { audienceOf, isScheduled } from '../../services/announcementService';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The send-date part of a form: a saved notice's own, or "now" for a new one. */
export function sendFormOf(a) {
    if (a && isScheduled(a)) {
        const d = new Date(a.published_at);
        return { sendMode: 'later', sendDate: localDay(d), sendTime: localTime(d), sentAt: null };
    }
    // Tomorrow at 9 is where "Schedule" starts.
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return { sendMode: 'now', sendDate: localDay(t), sendTime: '09:00', sentAt: a?.published_at || null };
}

/** The moment a form's send date names, as a local date-time, or null for "now". */
export function sendAtOf(form) {
    if (form.sendMode !== 'later' || !form.sendDate) return null;
    return `${form.sendDate}T${form.sendTime || '09:00'}`;
}

/** Problems with the send date and expiry before saving, in words, or ''. */
export function datesProblem(form) {
    const at = sendAtOf(form);
    if (form.sendMode === 'later') {
        if (!form.sendDate) return 'Pick the day it should go out.';
        if (new Date(at).getTime() <= Date.now()) return 'Pick a send date and time that is still to come, or send it now.';
    }
    if (form.expiresAt) {
        const end = new Date(`${form.expiresAt}T23:59:59`).getTime();
        if (at && end <= new Date(at).getTime()) return 'The expire date has to be after the send date.';
    }
    return '';
}

/** "Fri, 14 Nov 2026 at 09:00". */
export function whenText(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const day = `${d.toLocaleDateString('en-IN', { weekday: 'short' })}, ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    return `${day} at ${localTime(d)}`;
}

/**
 * Who a notice is for, in words, and the names behind it for a tooltip.
 * `scope` is what "everyone" means here: 'Whole team' or 'Everyone on the project'.
 */
export function audienceText(a, { nameOf, deptName = {}, scope = 'Whole team' }) {
    const ids = audienceOf(a);
    if (ids.length) {
        const names = ids.map((id) => nameOf(id)).filter(Boolean);
        const label = ids.length === 1 ? (names[0] || '1 member') : `${ids.length} members`;
        return { label, names: names.join(', ') };
    }
    if (a.department_id) return { label: `${deptName[a.department_id] || 'Department'} only`, names: '' };
    return { label: scope, names: '' };
}
