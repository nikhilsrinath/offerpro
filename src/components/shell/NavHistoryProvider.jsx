import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { NavHistoryContext, stepTrail, writeTrail } from './navHistory';

/** Tracks this tab's trail of pages for every back control (navHistory.js). */
export default function NavHistoryProvider({ children }) {
    const location = useLocation();
    const type = useNavigationType();
    const [trail, setTrail] = useState(() => stepTrail(null, location, type));
    // Moved on: step the trail during render, so the back label on the new
    // page is right on its first paint.
    let current = trail;
    if (trail.key !== location.key) {
        current = stepTrail(trail, location, type);
        setTrail(current);
    }
    useEffect(() => { writeTrail(trail); }, [trail]);
    const prev = current.idx > 0 ? current.stack[current.idx - 1] : null;
    const value = useMemo(() => ({ prev }), [prev]);
    return <NavHistoryContext.Provider value={value}>{children}</NavHistoryContext.Provider>;
}
