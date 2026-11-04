import React from 'react';
import { useOverviewModel } from '../overview/useOverviewModel';
import { TipProvider, CalendarHeat } from '../overview/vizKit';
import { fmtDay } from '../overview/overviewModel';

/* The activity calendar: documents issued per day over the last 26 weeks.
   It lives in the Logs panel's Activity view (RecordLogs.jsx). A day opens
   the Dashboard's drill-down sheet. The calendar does not depend on the
   period, so the model's period here is only what that sheet reports against. */

export default function HubActivity({ onDrill }) {
    const model = useOverviewModel('30D');
    const days = model.calendar;
    const active = days.filter((d) => d.count).length;
    const total = days.reduce((a, d) => a + d.count, 0);
    const busiest = days.reduce((m, d) => (d.count > m.count ? d : m), { count: 0 });
    return (
        <section className="hx-activity" aria-label="Activity" style={{ marginTop: 0 }}>
            <span className="hx-activity-note">Documents per day · last 26 weeks</span>
            <div className="hx-activity-card">
                <TipProvider>
                    <CalendarHeat days={days} onSelect={(d) => onDrill({ kind: 'day', date: d.date })} />
                </TipProvider>
                <div className="hx-activity-figs">
                    <span><b>{total.toLocaleString('en-IN')}</b>documents</span>
                    <span><b>{active}</b>active days</span>
                    <span><b>{busiest.count ? `${busiest.count} · ${fmtDay(busiest.date).slice(0, 6)}` : '-'}</b>busiest day</span>
                </div>
            </div>
        </section>
    );
}
