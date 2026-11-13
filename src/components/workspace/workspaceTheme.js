import {
    CalendarClock, CircleCheck, CheckSquare, Flag, FolderKanban, Receipt, Truck, RotateCcw,
    Plane, Cake, Megaphone,
} from 'lucide-react';

/* The colour and icon of each kind of calendar item. Colour stays inside the
   brand palette (navy, teal, light blue) plus the two status colours the app
   already uses for money in (green) and late (red), so the calendar reads as
   part of Opstead and not as a rainbow. */

export const SOURCE_ICON = {
    events: CalendarClock, mytasks: CircleCheck, tasks: CheckSquare, milestones: Flag, projects: FolderKanban,
    invoices: Receipt, bills: Truck, recurring: RotateCcw, leave: Plane, people: Cake, announcements: Megaphone,
};

export const warnOf = (t) => (t.isDark ? '#e0a020' : '#b26b00');
/** Navy that still shows on a dark page. */
export const navyOf = (t) => (t.isDark ? `color-mix(in srgb, ${t.navy} 35%, #b8c7d9)` : t.navy);

/** The colour an event's `color` names. */
export function eventColor(t, color) {
    switch (color) {
        case 'navy': return navyOf(t);
        case 'blue': return t.isDark ? '#7fb3d9' : `color-mix(in srgb, ${t.soft} 55%, ${t.navy})`;
        case 'grey': return t.faint;
        case 'red': return t.down;
        default: return t.teal;
    }
}

export const EVENT_COLORS = [
    { id: 'teal', label: 'Teal' },
    { id: 'navy', label: 'Navy' },
    { id: 'blue', label: 'Light Blue' },
    { id: 'grey', label: 'Grey' },
    { id: 'red', label: 'Red' },
];

/** The colour of a calendar item, by where it comes from. */
export function itemColor(t, it) {
    if (it.kind === 'event') return eventColor(t, it.color);
    switch (it.source) {
        case 'mytasks': return t.teal;
        case 'tasks': case 'milestones': case 'projects': return navyOf(t);
        case 'invoices': return t.up;
        case 'bills': return warnOf(t);
        case 'recurring': return t.teal;
        case 'leave': return eventColor(t, 'blue');
        case 'people': return t.accent;
        default: return t.faint;
    }
}
