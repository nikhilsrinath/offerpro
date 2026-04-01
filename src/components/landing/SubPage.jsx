import React, { useRef, useEffect, Suspense } from 'react';
import SubPageNav from './SubPageNav';
import SubPageFooter from './SubPageFooter';
import { useScrollParallax } from '../../hooks/useScrollParallax';
import { useCardGlow } from '../../hooks/useCardGlow';
import '../LandingPage.css';
import './SubPage.css';

const SubPage = ({ children }) => {
  const pageRef = useRef(null);
  useScrollParallax();
  useCardGlow(pageRef);

  useEffect(() => {
    const prev = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    window.scrollTo(0, 0);
    return () => document.documentElement.setAttribute('data-theme', prev || 'light');
  }, []);

  return (
    <div className="eos-landing" ref={pageRef}>
      <SubPageNav />
      <Suspense fallback={
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: 'var(--eos-text-muted)', fontSize: '0.875rem' }}>Loading...</div>
        </div>
      }>
        {children}
      </Suspense>
      <SubPageFooter />
    </div>
  );
};

export default SubPage;
