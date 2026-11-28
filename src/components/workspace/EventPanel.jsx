import React, { useMemo, useState } from 'react';
import { Btn, Seg, Field, Input, Select, Textarea, Modal, ConfirmBtn } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import ProjectSelect from '../shared/ProjectSelect';
import { workspaceService } from '../../services/workspaceService';
import { REPEATS, blankEvent, eventToForm, formToEvent, addDays, daysBetween, localDay } from './calendarModel';
import { EVENT_COLORS, eventColor } from './workspaceTheme';

/* The side panel for one of the person's own events: new, or an existing one
   opened from the calendar. A repeating event is one row; editing or deleting
   it changes the whole series, and the panel says so. */

export default function EventPanel({ orgId, event = null, start = null, onClose, projects = [] }) {
    const t = useT();
    const toast = useToast();
    const isEdit = !!event;
    const [form, setForm] = useState(() => {
        if (event) return eventToForm(event);
        const f = { ...blankEvent(start?.day || localDay(), start?.hour ?? null), all_day: !!start?.allDay };
        // A slot clicked on the week grid: start there, one hour long.
        if (start?.minutes != null) {
            const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            f.startTime = hm(start.minutes);
            f.endTime = hm(Math.min(23 * 60 + 59, start.minutes + 60));
        }
        return f;
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const set = (key) => (v) => setForm((f) => {
        const value = v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v;
        const next = { ...f, [key]: value };
        // Moving the start moves the end with it, keeping the length.
        if (key === 'startDay' && f.startDay && value) {
            const len = Math.max(0, daysBetween(f.startDay, f.endDay));
            next.endDay = addDays(value, len);
        }
        if (key === 'startTime' && f.startTime && value && f.startDay === f.endDay) {
            const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
            const len = Math.max(15, toMin(f.endTime) - toMin(f.startTime));
            const end = Math.min(23 * 60 + 59, toMin(value) + len);
            next.endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
        }
        return next;
    });

    // By name, A to Z: the list reads as names, so they come first.
    const pickable = useMemo(() => projects.filter((p) => !p.archived_at || p.id === form.project_id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [projects, form.project_id]);

    const save = async () => {
        const { row, error: err } = formToEvent(form);
        if (err) { setError(err); return; }
        setSaving(true);
        setError('');
        try {
            if (isEdit) await workspaceService.update('events', event.id, row);
            else await workspaceService.create('events', orgId, row);
            toast(isEdit ? 'Event updated' : 'Event added to your calendar', 'success');
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        try {
            await workspaceService.remove('events', event.id);
            toast('Event deleted', 'success', 6000, {
                label: 'Undo',
                onClick: () => workspaceService.restore('events', [event]).catch((e) => toast(e.message, 'error')),
            });
            onClose();
        } catch (e) {
            setError(e.message);
        }
    };

    const repeating = form.repeat !== 'none';
    const gap = <div style={{ height: 13 }} />;

    return (
        <Modal open onClose={onClose} width={680}
            title={isEdit ? 'Edit event' : 'New event'}
            note={isEdit && event.repeat !== 'none' ? 'A repeating event: changes apply to every date in the series' : 'Only you can see your events'}
            footer={(
                <>
                    {isEdit && (
                        <ConfirmBtn size="md" label={event.repeat !== 'none' ? 'Delete series' : 'Delete event'} confirmLabel="Delete"
                            title={event.repeat !== 'none' ? 'Delete this repeating event' : 'Delete event'}
                            message={event.repeat !== 'none' ? 'Every date in the series is removed from your calendar.' : 'The event is removed from your calendar.'}
                            onConfirm={remove} />
                    )}
                    <div style={{ flex: 1 }} />
                    <Btn onClick={onClose}>Cancel</Btn>
                    <Btn primary onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save event'}</Btn>
                </>
            )}>
            <>
                <Field required label="Title">
                    <Input value={form.title} onChange={set('title')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} placeholder="Meeting with Acme, dentist, review…" autoFocus maxLength={500} />
                </Field>
                {gap}
                <Field label="Type">
                    <Seg value={form.all_day ? 'all' : 'timed'} onChange={(v) => set('all_day')(v === 'all')} label="Event type" options={[
                        { id: 'timed', label: 'At a time' }, { id: 'all', label: 'All day' },
                    ]} />
                </Field>
                {gap}
                <Field required label="Starts">
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Input type="date" value={form.startDay} onChange={set('startDay')} aria-label="Start date" style={{ flex: 1 }} />
                        {!form.all_day && <Input type="time" value={form.startTime} onChange={set('startTime')} aria-label="Start time" style={{ width: 130 }} />}
                    </div>
                </Field>
                {gap}
                <Field required label="Ends">
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Input type="date" value={form.endDay} min={form.startDay} onChange={set('endDay')} aria-label="End date" style={{ flex: 1 }} />
                        {!form.all_day && <Input type="time" value={form.endTime} onChange={set('endTime')} aria-label="End time" style={{ width: 130 }} />}
                    </div>
                </Field>
                {gap}
                <Field label="Repeat">
                    <Select value={form.repeat} onChange={set('repeat')}>
                        {REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </Select>
                </Field>
                {repeating && (
                    <>
                        {gap}
                        <Field label="Repeat until" hint="Leave blank to keep repeating">
                            <Input type="date" value={form.repeat_until} min={form.startDay} onChange={set('repeat_until')} />
                        </Field>
                    </>
                )}
                {gap}
                <Field label="Location" hint="A room, an address or a meeting link">
                    <Input value={form.location} onChange={set('location')} maxLength={500} />
                </Field>
                {gap}
                <Field label="Colour">
                    <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', gap: 8, alignItems: 'center', height: 32 }}>
                        {EVENT_COLORS.map((c) => {
                            const on = form.color === c.id;
                            return (
                                <button key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label}
                                    onClick={() => set('color')(c.id)}
                                    style={{
                                        width: 24, height: 24, borderRadius: '50%', padding: 0, cursor: 'pointer',
                                        background: eventColor(t, c.id), border: '2px solid ' + (on ? t.text : 'transparent'),
                                        boxShadow: on ? `inset 0 0 0 2px ${t.card}` : 'none',
                                    }} />
                            );
                        })}
                    </div>
                </Field>
                {pickable.length > 0 && (
                    <>
                        {gap}
                        <Field label="Project" hint="Optional, to keep the event with its work">
                            {/* Names on the left, codes in a column on the right. */}
                            <ProjectSelect id="ev-project" projects={pickable} value={form.project_id || ''} onChange={set('project_id')} />
                        </Field>
                    </>
                )}
                {gap}
                <Field label="Notes">
                    <Textarea rows={4} value={form.description} onChange={set('description')} placeholder="Agenda, links, what to bring" />
                </Field>
                {error && <div role="alert" style={{ marginTop: 13, fontSize: 12.5, color: t.down }}>{error}</div>}

            </>
        </Modal>
    );
}
