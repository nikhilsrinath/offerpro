import { useEffect, useLayoutEffect, useRef } from 'react';

/* Keeps a table's column titles in view while the page scrolls, with no
   scrollbar of the table's own. CSS sticky would only hold them inside the
   table's sideways-scrolling box, so the header is moved down by hand to the
   top of the page's scrolling area, and no further than the table's last row.
   Put `boxRef` on the box around the table and `headRef` on its <thead>.
   `on` should be true only while the table is rendered, so it hooks up when
   the table first appears. */
export function useStickyHead(on = true) {
    const boxRef = useRef(null);
    const headRef = useRef(null);
    const placeRef = useRef(() => {});
    useEffect(() => {
        const box = boxRef.current;
        if (!on || !box) return undefined;
        let scroller = box.parentElement;
        while (scroller && scroller !== document.body && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        if (scroller === document.body) scroller = null;
        const place = () => {
            const head = headRef.current;
            if (!head) return;
            const top = scroller ? scroller.getBoundingClientRect().top : 0;
            const r = box.getBoundingClientRect();
            const y = Math.max(0, Math.min(top - r.top, r.height - head.offsetHeight * 2));
            head.style.transform = y > 0 ? `translateY(${y}px)` : '';
        };
        placeRef.current = place;
        place();
        const target = scroller || window;
        target.addEventListener('scroll', place, { passive: true });
        window.addEventListener('resize', place);
        return () => {
            target.removeEventListener('scroll', place);
            window.removeEventListener('resize', place);
            placeRef.current = () => {};
        };
    }, [on]);
    // Rows added, removed or paged: the header's place is worked out again.
    useLayoutEffect(() => { placeRef.current(); });
    return { boxRef, headRef };
}
