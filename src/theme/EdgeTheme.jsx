import { createContext, useContext, useState, useEffect } from 'react';
import { makeTokens } from './edge';

/* The theme a page should paint itself in.

   useTheme() holds its own useState per caller, so a page that called it got a
   second, unsynchronised copy of the theme — toggling in the shell left the
   page behind, and the page's effect could even write the stale value back onto
   <html>. Pages read the theme from here instead: the shell provides it, and
   anything rendered outside a shell falls back to watching the attribute that
   is already on <html>, which is the single source of truth either way. */

export const EdgeThemeContext = createContext(null);

function useHtmlTheme() {
    const read = () => (typeof document === 'undefined'
        ? 'light'
        : (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'));

    const [theme, setTheme] = useState(read);

    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined;
        const obs = new MutationObserver(() => setTheme(read()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => obs.disconnect();
    }, []);

    return theme;
}

export function useEdgeTheme() {
    const provided = useContext(EdgeThemeContext);
    const observed = useHtmlTheme();
    const theme = provided || observed;
    return { theme, t: makeTokens(theme === 'dark'), isDark: theme === 'dark' };
}
