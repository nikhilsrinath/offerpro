import { useEffect } from 'react';

export function useCardGlow(containerRef) {
  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current) return;
      const cards = containerRef.current.querySelectorAll('.eos-feature-card');
      cards.forEach((card) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
        card.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
      });
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [containerRef]);
}
