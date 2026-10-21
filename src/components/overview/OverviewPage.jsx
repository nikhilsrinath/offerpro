import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { documentStore } from '../../services/documentStore';
import { MONO } from '../../theme/edge';
import { useEdgeTheme } from '../../theme/EdgeTheme';
import CountryDialog from '../CountryDialog';
import { useAssistant } from '../assistant/assistantStore';
import { useHubData } from '../hub/useHubData';
import { useWidgetLayout } from '../hub/useWidgetLayout';
import { WIDGETS, WIDGET_BY_ID, DEFAULT_LAYOUT, WIDGET_GROUPS } from '../hub/widgetCatalog';
import { previewHubData } from '../hub/previewData';
import WidgetBoard from '../hub/WidgetBoard';
import WidgetDrill from '../hub/WidgetDrill';
import HubActivity from '../hub/HubActivity';
import '../../theme/surface.css';
import '../hub/hub.css';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard → Overview: the workspace's first page. What used to be the hub,
   inside the Dashboard module: the company's name, a board of widgets the
   person chooses, and the activity calendar under it.

   The board is the person's own: ten widgets by default, any of the catalog
   addable, each removable, resizable and movable (menu, keyboard or drag).
   The greeting names the company, never the person's email.
   ══════════════════════════════════════════════════════════════════════════ */

const GEO_PERIODS = [
    { id: '30D', api: '30d' },
    { id: '3M', api: '3m' },
    { id: '6M', api: '6m' },
    { id: '12M', api: '12m' },
];

function useWindowWidth() {
    const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

function useNow(every) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), every);
        return () => clearInterval(id);
    }, [every]);
    return now;
}

export default function OverviewPage() {
    const { theme, t } = useEdgeTheme();
    const { activeOrg } = useOrg();
    const navigate = useNavigate();
    const assistant = useAssistant();
    // One period for the map, the markets list and the country dialog.
    const [geoPeriod, setGeoPeriod] = useState('12M');
    const d = useHubData(activeOrg, geoPeriod);
    const [layout, lay] = useWidgetLayout(activeOrg?.id);

    const isMobile = useWindowWidth() < 760;
    const now = useNow(60000);

    const [openCountry, setOpenCountry] = useState(null);
    const [geoMap, setGeoMap] = useState(null);
    const [galleryOpen, setGalleryOpen] = useState(false); // the widget gallery previews the map too
    const [announce, setAnnounce] = useState('');
    const say = (msg) => setAnnounce(msg);

    // The drill-down sheet, opened from a day on the activity calendar.
    // Widgets open their own pages instead (widgetCatalog `to`).
    const [drill, setDrill] = useState([]);
    const pushDrill = useCallback((v) => setDrill((s) => [...s, v]), []);
    const popDrill = useCallback(() => setDrill((s) => s.slice(0, -1)), []);
    const closeDrill = useCallback(() => setDrill([]), []);

    // World geometry is its own chunk; only fetch it once something needs it.
    const needsMap = layout.some((w) => w.id === 'geomap') || !!openCountry || galleryOpen;
    useEffect(() => {
        if (!needsMap || geoMap) return undefined;
        let cancelled = false;
        import('../../data/worldMap.js')
            .then((m) => { if (!cancelled) setGeoMap(m); })
            .catch(() => { if (!cancelled) setGeoMap(false); });
        return () => { cancelled = true; };
    }, [needsMap, geoMap]);

    // Markets lists names before the map chunk arrives; Intl covers that gap.
    const names = useMemo(() => {
        if (geoMap) return geoMap.COUNTRY_NAMES;
        let dn = null;
        try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old browser */ }
        return new Proxy({}, { get: (_, code) => { try { return dn?.of(String(code)) || code; } catch { return code; } } });
    }, [geoMap]);

    /** A question from a widget: EdgeAI opens full screen with it. */
    const askCopilot = useCallback((text) => {
        const ok = assistant.askNew(text);
        if (ok) assistant.setOpen(true);
        return ok;
    }, [assistant]);

    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
    const orgName = activeOrg?.company_name || activeOrg?.name || 'Your company';

    const widgetProps = {
        d, nav: navigate, ask: askCopilot, geoMap, countryNames: names,
        openCountry: (code) => setOpenCountry(code),
        geoPeriod, setGeoPeriod,
    };
    // What the widget gallery draws each widget with: the same props on sample
    // figures, and every action a no-op.
    const previewProps = {
        ...widgetProps, d: previewHubData(), nav: () => {}, ask: () => false,
        openCountry: () => {}, setGeoPeriod: () => {},
    };

    return (
        <div className="nm-root eo-surface eo-v2" data-theme={theme} style={{
            display: 'grid', gap: isMobile ? 12 : 16, alignContent: 'start',
            // One column that may shrink below its content, so the widget grid
            // always sees the real width and re-flows.
            gridTemplateColumns: 'minmax(0, 1fr)',
            background: 'transparent', fontFamily: MONO, color: t.text,
        }}>
            <div className="eo-sr" role="status" aria-live="polite">{announce}</div>

            {/* greeting */}
            <div style={{ padding: '2px 2px 2px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: isMobile ? 13 : 14, fontWeight: 500, color: t.dim }}>{greeting}</p>
                    <h2 style={{
                        margin: '2px 0 0', fontSize: isMobile ? 22 : 28, fontWeight: 700,
                        letterSpacing: '-0.03em', color: t.text, lineHeight: 1.15,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{orgName}</h2>
                </div>
                {!isMobile && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 13px',
                        borderRadius: 11, border: '1px solid ' + t.lineStrong, background: t.card,
                        boxShadow: t.highlight, fontSize: 13.5, color: t.text, whiteSpace: 'nowrap',
                    }}>
                        <CalendarDays size={15} strokeWidth={1.8} aria-hidden="true" style={{ color: t.dim }} />
                        {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                )}
            </div>

            {d.loadError && <div className="hx-alert" role="alert">Some data could not be loaded: {d.loadError}</div>}

            <WidgetBoard
                layout={layout} lay={lay} widgets={WIDGETS} byId={WIDGET_BY_ID}
                defaultCount={DEFAULT_LAYOUT.length}
                widgetProps={widgetProps} metaArgs={{ geoPeriod }}
                isMobile={isMobile} say={say}
                emptyText="Add widgets to keep revenue, cash, clients and EdgeBrain in one view."
                pickerNote="Choose what the overview shows"
                groups={WIDGET_GROUPS} previewProps={previewProps} onGallery={setGalleryOpen}
            />

            <HubActivity onDrill={(v) => setDrill([v])} />

            {drill.length > 0 && <WidgetDrill stack={drill} push={pushDrill} pop={popDrill} close={closeDrill} />}

            {openCountry && (
                <CountryDialog
                    t={t} font={MONO} code={openCountry}
                    name={names[openCountry] || openCountry}
                    path={geoMap ? geoMap.COUNTRY_PATHS[openCountry] : null}
                    geoRow={d.geo.byCode.get(openCountry) || null}
                    rank={d.geo.ranked.findIndex((r) => r.code === openCountry) + 1 || null}
                    marketCount={d.geo.ranked.length}
                    period={geoPeriod} periods={GEO_PERIODS} onPeriod={setGeoPeriod}
                    finDocs={d.finDocs} clients={documentStore.getSavedClients() || []}
                    income={d.income} expenses={d.expenses}
                    isMobile={isMobile}
                    onClose={() => setOpenCountry(null)}
                    onNavigate={navigate}
                />
            )}

            {/* The country dialog's hovers, as the hub drew them. */}
            <style>{`
                .nm-scroll::-webkit-scrollbar-thumb { background: ${t.lineStrong}; background-clip: content-box; }
                .nm-seg:hover { color: ${t.text} !important; }
                .nm-nav:hover { color: ${t.text} !important; background: ${t.panelAlt}; }
            `}</style>
        </div>
    );
}
