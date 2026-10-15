import { useCallback, useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { confirmDialog } from '../services/confirm';

/* Asks before leaving a document editor (offer letter, certificate, the
   templates) once something has been typed or picked on it.

   The app runs on <BrowserRouter>, which has no useBlocker, so the router's
   own push and replace are wrapped while the editor is open: every in-app
   move (sidebar, tabs, Back buttons, links) goes through them and waits on
   the app's confirm dialog. Closing or reloading the tab gets the browser's
   own "Leave site?" prompt.

   Spread `formProps` on the <form>: any change or button press inside it marks
   the editor as worked on. Call `release()` once the document is saved, just
   before navigating away, so saving never asks. */

const pathOf = (to) => (typeof to === 'string' ? to.split(/[?#]/)[0] : to?.pathname) || '';

export function useLeaveGuard() {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const dirty = useRef(false);

  useEffect(() => {
    const { push, replace } = navigator;
    const guard = (go) => (to, ...rest) => {
      const target = pathOf(to);
      // Staying on this page (a query or hash change) loses nothing.
      if (!dirty.current || !target || target === window.location.pathname) return go.call(navigator, to, ...rest);
      confirmDialog({
        title: 'Leave this page?',
        message: 'What you have entered on this document has not been saved and will be lost.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
      }).then((ok) => {
        if (!ok) return;
        dirty.current = false;
        go.call(navigator, to, ...rest);
      });
    };
    // The router's history object, not React state: patched in place and put back on unmount.
    Object.assign(navigator, { push: guard(push), replace: guard(replace) });

    const onUnload = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      Object.assign(navigator, { push, replace });
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [navigator]);

  const markDirty = useCallback(() => { dirty.current = true; }, []);
  const release = useCallback(() => { dirty.current = false; }, []);
  // Folding an "Adjust" panel open or shut changes nothing on the document.
  const onClickCapture = useCallback((e) => {
    const btn = e.target.closest?.('button');
    if (btn && !btn.hasAttribute('aria-expanded')) dirty.current = true;
  }, []);

  return { markDirty, release, formProps: { onChangeCapture: markDirty, onClickCapture } };
}
