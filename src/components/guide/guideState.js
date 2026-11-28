import { useEffect, useState } from 'react';
import { prefGet, prefSet, PREFS_EVENT } from '../../services/userPrefs';

/* Which page tips a person has dismissed, how often they have seen each,
   and whether they turned them all off. One synced setting (user_preferences,
   0116), so a tip dismissed on the laptop stays dismissed on the phone.

   A tip retires on its own after MAX_VIEWS visits to its page, so someone who
   never clicks "Got it" is not shown it forever. */

export const GUIDE_PREF = 'opstead.guides';
export const MAX_VIEWS = 3;
const CHANGED = 'opstead:guides';

function read() {
    try {
        const v = JSON.parse(prefGet(GUIDE_PREF) || '{}');
        const views = v.views && typeof v.views === 'object' ? v.views : {};
        return { done: Array.isArray(v.done) ? v.done : [], off: !!v.off, views };
    } catch {
        return { done: [], off: false, views: {} };
    }
}
function write(next) {
    prefSet(GUIDE_PREF, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGED));
}

/** Hide one page's tip. */
export const dismissGuide = (key) => {
    const s = read();
    if (!s.done.includes(key)) write({ ...s, done: [...s.done, key] });
};
/** Count one visit to a page while its tip shows. */
export const countGuideView = (key) => {
    const s = read();
    write({ ...s, views: { ...s.views, [key]: (Number(s.views[key]) || 0) + 1 } });
};
/** Whether a page's tip still shows: not dismissed, not all off, under its visit limit. */
export const guideOpen = (s, key) => !s.off && !s.done.includes(key) && (Number(s.views[key]) || 0) < MAX_VIEWS;

/** Hide every tip. */
export const hideAllGuides = () => write({ ...read(), off: true });
/** Bring every tip back. */
export const resetGuides = () => write({ done: [], off: false, views: {} });

/** The live state, following changes from this tab and from other devices. */
export function useGuideState() {
    const [state, setState] = useState(read);
    useEffect(() => {
        const on = () => setState(read());
        window.addEventListener(CHANGED, on);
        window.addEventListener(PREFS_EVENT, on);
        return () => { window.removeEventListener(CHANGED, on); window.removeEventListener(PREFS_EVENT, on); };
    }, []);
    return state;
}
