import React, { useCallback, useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { MONO } from '../../theme/edge';

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
        return () => {
            window.removeEventListener(EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    const setPinned = useCallback((next) => {
        setPinnedState(next);
        try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* private mode */ }
        window.dispatchEvent(new Event(EVENT));
    }, []);

    return [pinned, setPinned];
}

/* The control itself: pin the rail open, or close it again. It only shows
   while the rail is wide, since collapsed there is no room for it — and no
   need, the rail is already closed. */
export function RailPinButton({ t, pinned, onToggle, visible }) {
    const Icon = pinned ? PanelLeftClose : PanelLeftOpen;
    return (
        <button
            type="button"
            className="edge-navitem"
            onClick={onToggle}
            title={pinned ? 'Close sidebar' : 'Keep sidebar open'}
            aria-label={pinned ? 'Close sidebar' : 'Keep sidebar open'}
            aria-pressed={pinned}
            tabIndex={visible ? 0 : -1}
            style={{
                display: 'grid', placeItems: 'center', flexShrink: 0,
                width: 28, height: 28, marginRight: -4, borderRadius: 7,
                border: '1px solid transparent', background: 'transparent',
                color: pinned ? t.text : t.faint, cursor: 'pointer',
                fontFamily: MONO, padding: 0,
                opacity: visible ? 1 : 0,
                pointerEvents: visible ? 'auto' : 'none',
                transition: 'opacity .16s, color .14s, background .14s',
            }}
        >
            <Icon aria-hidden="true" size={16} strokeWidth={1.7} />
        </button>
    );
}
