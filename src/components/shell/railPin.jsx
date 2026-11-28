import React, { useCallback, useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { MONO } from '../../theme/edge';
import { prefSet, PREFS_EVENT } from '../../services/userPrefs';

/* Whether the navigation rail stays open on its own.

   The rail widens on hover, which is quick but forgetful: on a wide screen
   people would rather have the labels there all the time. The choice is one
   per person, not one per page, so it is kept in localStorage and broadcast,
   letting the hub and every module shell agree the moment it changes. */

const KEY = 'edge.rail.pinned';
const EVENT = 'edge:rail-pinned';

function read() {
    try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function useRailPin() {
    const [pinned, setPinnedState] = useState(() => (typeof window === 'undefined' ? false : read()));

    useEffect(() => {
        const sync = () => setPinnedState(read());
        window.addEventListener(EVENT, sync);
        window.addEventListener('storage', sync);
        // Pinned or unpinned on another device.
        window.addEventListener(PREFS_EVENT, sync);
        return () => {
            window.removeEventListener(EVENT, sync);
            window.removeEventListener('storage', sync);
            window.removeEventListener(PREFS_EVENT, sync);
        };
    }, []);

    const setPinned = useCallback((next) => {
        setPinnedState(next);
        prefSet(KEY, next ? '1' : '0');
        window.dispatchEvent(new Event(EVENT));
    }, []);

    return [pinned, setPinned];
}

/* The control itself: pin the rail open, or close it again. It only shows
   while the rail is wide, since collapsed there is no room for it. And no
   need, the rail is already closed. */
export function RailPinButton({ t, pinned, onToggle, visible = true }) {
    const Icon = pinned ? PanelLeftClose : PanelLeftOpen;
    return (
        <button
            type="button"
            onClick={onToggle}
            title={pinned ? 'Close sidebar' : 'Keep sidebar open'}
            aria-label={pinned ? 'Close sidebar' : 'Keep sidebar open'}
            aria-pressed={pinned}
            tabIndex={visible ? 0 : -1}
            className="edge-navitem ri-ibtn"
            style={{
                // The same 28px tile as the account buttons it sits beside in the rail's foot.
                display: 'grid', placeItems: 'center', flexShrink: 0,
                width: 28, height: 28, borderRadius: 7,
                border: '1px solid ' + t.line, background: t.panelAlt,
                color: pinned ? t.text : t.dim, cursor: 'pointer',
                fontFamily: MONO, padding: 0,
                opacity: visible ? 1 : 0,
                pointerEvents: visible ? 'auto' : 'none',
                transition: 'opacity .16s, color .14s, background .14s',
            }}
        >
            <Icon aria-hidden="true" size={15} strokeWidth={1.7} />
        </button>
    );
}
