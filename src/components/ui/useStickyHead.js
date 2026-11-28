import { useEffect, useLayoutEffect, useRef } from 'react';

/* Keeps a table's column titles in view while the page scrolls, with no
   scrollbar of the table's own: the page scrolls, never the table.
   Put `boxRef` on the box around the table and `headRef` on its <thead>.
   `on` should be true only while the table is rendered, so it hooks up when
   the table first appears.

   When the table fits its box (the usual case), the box clips instead of
   scrolling sideways and the header is CSS `position: sticky` against the
   page's scrolling area. The browser moves it in the same frame as the
   scroll, so it never lags or flickers.

   Only a table wider than its box has to scroll sideways, and a sideways
   scrolling box is what CSS sticky would hold the header inside of. Then the
   header is moved down by hand instead, to the top of the page's scrolling
   area and no further than the table's last row. */
const SCROLLS = /(auto|scroll)/;
const CLIPS_ONLY = /^(visible|clip)$/;

export function useStickyHead(on = true) {
    const boxRef = useRef(null);
    const headRef = useRef(null);
    const placeRef = useRef(() => {});
    useEffect(() => {
        const box = boxRef.current;
        if (!on || !box) return undefined;
        let scroller = box.parentElement;
        while (scroller && scroller !== document.body && !SCROLLS.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        if (scroller === document.body) scroller = null;
        // CSS sticky holds to the nearest box that clips or scrolls; anything
        // between the table and the page's scroller that hides its overflow
        // would keep it from sticking, so the header is moved by hand then.
        let clear = true;
        for (let el = box.parentElement; el && el !== scroller && el !== document.body; el = el.parentElement) {
            const cs = getComputedStyle(el);
            if (!CLIPS_ONLY.test(cs.overflowX) || !CLIPS_ONLY.test(cs.overflowY)) { clear = false; break; }
        }
        const boxOverflow = box.style.overflowX;
        const boxOverflowY = box.style.overflowY;
        const headEl = headRef.current;
        let mode = null;

        const place = () => {
            const head = headRef.current;
            if (!head) return;
            const table = head.closest('table');
            const wide = !!table && table.offsetWidth > box.clientWidth + 1;
            const next = clear && !wide ? 'sticky' : 'moved';
            if (next !== mode) {
                mode = next;
                if (mode === 'sticky') {
                    // Clipped both ways: `clip` is not a scroll box, so the header still
                    // sticks to the page, and a rounded box keeps its rounded corners
                    // (clipping one axis only leaves the header's corners square).
                    box.style.overflowX = 'clip';
                    box.style.overflowY = 'clip';
                    head.style.position = 'sticky';
                    // Sticky holds below the scroller's own padding; pull it up
                    // over that gutter so no row shows above the header.
                    head.style.top = `-${scroller ? parseFloat(getComputedStyle(scroller).paddingTop) || 0 : 0}px`;
                    head.style.transform = '';
                } else {
                    box.style.overflowX = boxOverflow || 'auto';
                    box.style.overflowY = boxOverflowY;
                    head.style.position = 'relative';
                    head.style.top = '';
                }
                head.style.zIndex = '3';
            }
            if (mode === 'moved') {
                const top = scroller ? scroller.getBoundingClientRect().top : 0;
                const r = box.getBoundingClientRect();
                const y = Math.max(0, Math.min(top - r.top, r.height - head.offsetHeight * 2));
                head.style.transform = y > 0 ? `translateY(${y}px)` : '';
            }
        };
        placeRef.current = place;
        place();
        const target = scroller || window;
        const onScroll = () => { if (mode === 'moved') place(); };
        target.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', place);
        // A column shown or hidden, or the page narrowed: the table may now fit, or not.
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
        ro?.observe(box);
        const table = headEl?.closest('table');
        if (table) ro?.observe(table);
        return () => {
            target.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', place);
            ro?.disconnect();
            placeRef.current = () => {};
            box.style.overflowX = boxOverflow;
            box.style.overflowY = boxOverflowY;
            if (headEl) { headEl.style.position = ''; headEl.style.top = ''; headEl.style.transform = ''; headEl.style.zIndex = ''; }
        };
    }, [on]);
    // Rows added, removed or paged: the header's place is worked out again.
    useLayoutEffect(() => { placeRef.current(); });
    return { boxRef, headRef };
}
