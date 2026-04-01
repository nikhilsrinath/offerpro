import { useEffect } from 'react';

export function useScrollParallax() {
  useEffect(() => {
    const els = document.querySelectorAll('.eos-parallax');
    const progressFill = document.querySelector('.eos-tl-progress-fill');
    const tlSection = document.querySelector('.eos-tl-section');
    if (!els.length) return;

    const peakMap = new WeakMap();

    const onScroll = () => {
      const windowH = window.innerHeight;

      if (progressFill && tlSection) {
        const sr = tlSection.getBoundingClientRect();
        const scrolled = Math.max(0, -sr.top + windowH * 0.3);
        const total = sr.height - windowH * 0.4;
        progressFill.style.height = `${Math.min(1, Math.max(0, scrolled / total)) * 100}%`;
      }

      els.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const viewCenter = windowH / 2;
        const dist = center - viewCenter;
        const rawNorm = Math.min(1, Math.max(0, 1 - Math.abs(dist) / (windowH * 0.45)));

        const prev = peakMap.get(el) || 0;
        const norm = Math.max(rawNorm, prev);
        peakMap.set(el, norm);

        const scale = 0.88 + norm * 0.12;
        const opacity = 0.05 + norm * 0.95;
        const translateY = (1 - norm) * 40;
        const blur = (1 - norm) * 1.8;

        el.style.transform = `scale(${scale}) translateY(${translateY}px)`;
        el.style.opacity = opacity;
        el.style.filter = `blur(${blur}px)`;

        const dot = el.querySelector('.eos-tl-dot');
        if (dot && norm > 0.6) {
          dot.classList.add('active');
        }
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
}
