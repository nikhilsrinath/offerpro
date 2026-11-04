import { useCallback, useState } from 'react';

/* useState that keeps its value in sessionStorage, so a page's filters and
   sort are still as the person left them after they go to another page and
   come back. Cleared when the tab closes. Blocked storage just means the
   choice lasts until the page unmounts. */
const PREFIX = 'opstead.ui.';

export default function useRememberedState(key, initial) {
    const storeKey = PREFIX + key;
    const [value, setValue] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storeKey);
            if (raw != null) return JSON.parse(raw);
        } catch { /* storage blocked or bad JSON: fall back */ }
        return typeof initial === 'function' ? initial() : initial;
    });
    const set = useCallback((next) => {
        setValue((prev) => {
            const v = typeof next === 'function' ? next(prev) : next;
            try { sessionStorage.setItem(storeKey, JSON.stringify(v)); } catch { /* ignore */ }
            return v;
        });
    }, [storeKey]);
    return [value, set];
}
