// OverviewTab — the portal's first screen: today, how the month is going, and
// the three things a person most often comes here to do.
import { useMemo } from 'react';
import { Plane, CalendarDays, Megaphone, UserRound, Pin, ArrowRight } from 'lucide-react';
import { Panel, Bar, Btn, Empty } from '../../ui/edge';
import { HoursPerDayChart, MonthsWorkedChart, CheckInChart } from './WorkCharts';
import { useT, MONO } from '../../ui/edgeUtils';
import { LEAVE_STATUSES } from '../../../services/leaveService';
import { currentMonthKey, formatDuration, todayKey } from '../../../services/attendanceService';
import { ClockCard, Kpi, PhotoAvatar, SectionLabel } from './portalKit';
import {
  monthInsights, attendanceStreak, dailySeries, recentMonths, monthLabel, minutesToClock,
  hoursLabel, profileCompleteness, fmtLongDay,
} from './portalUtils';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function OverviewTab({
  me, today, clocking, onClock, balances, history, requests, notices, readIds, typeName, go, narrow,
}) {
  const t = useT();
  const monthKey = currentMonthKey();
  const rows = history[monthKey] || {};
  const ins = monthInsights(monthKey, rows);
  const allRows = useMemo(() => Object.assign({}, ...Object.values(history)), [history]);
  const streak = attendanceStreak(allRows);
  const series = dailySeries(monthKey, rows);
  const months = recentMonths(6).map((k) => {
    const m = monthInsights(k, history[k] || {});
    return { key: k, label: monthLabel(k, 'short'), days: m.daysWorked, minutes: m.minutes, rate: m.rate };
  });
  const checkIns = series.filter((d) => d.checkIn != null);
  const profile = profileCompleteness(me);
  const unread = notices.filter((a) => !readIds.has(a.id)).length;
  const pending = requests.filter((r) => r.status === 'pending');
  const upcoming = requests
    .filter((r) => r.status === 'approved' && r.end_date >= todayKey())
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const leaveLeft = balances.reduce((s, b) => s + Number(b.remaining || 0), 0);

  const firstName = (me.full_name || '').split(/\s+/)[0];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* ── hero: who, and today ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.7fr) minmax(260px, 1fr)' }}>
        <div style={{
          border: '1px solid ' + t.line, borderRadius: 12, background: t.panel, padding: 18,
          display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0,
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
            <PhotoAvatar name={me.full_name} path={me.photo_path} size={58} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: t.faint }}>{greeting()},</div>
              <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.03em', color: t.text, marginTop: 2 }}>{firstName || me.full_name}</div>
              <div style={{ fontSize: 10.5, color: t.dim, marginTop: 4 }}>
                {[me.role, me.department_name].filter(Boolean).join(' · ') || 'Team member'}
                {me.manager && <span style={{ color: t.faint }}> · reports to {me.manager.full_name}</span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <QuickAction icon={Plane} label="Request leave" note={`${leaveLeft} days available`} onClick={() => go('leave')} />
            <QuickAction icon={CalendarDays} label="My attendance" note={`${ins.daysWorked} days this month`} onClick={() => go('attendance')} />
            <QuickAction icon={Megaphone} label="Announcements" note={unread ? `${unread} unread` : 'All caught up'} onClick={() => go('announcements')} dot={unread > 0} />
          </div>

          {profile.done < profile.total && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '10px 12px', borderRadius: 9, background: t.panelAlt, border: '1px solid ' + t.lineSoft,
            }}>
              <UserRound size={15} style={{ color: t.dim, flexShrink: 0 }} />
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ fontSize: 11, color: t.text }}>Your profile is {profile.done} of {profile.total} complete</div>
                <div style={{ fontSize: 9.5, color: t.faint, margin: '3px 0 6px' }}>Missing: {profile.missing.join(', ')}</div>
                <Bar value={profile.done} max={profile.total} />
              </div>
              <Btn size="sm" onClick={() => go('profile')}>Complete profile <ArrowRight size={12} /></Btn>
            </div>
          )}
        </div>

        <ClockCard today={today} clocking={clocking} onClock={onClock} />
      </div>

      {/* ── the month in four numbers ────────────────────────────────────── */}
      <div>
        <SectionLabel>{monthLabel(monthKey)}</SectionLabel>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Kpi
            label="Attendance rate"
            value={ins.rate == null ? '—' : `${Math.round(ins.rate * 100)}%`}
            share={ins.rate}
            note={`${ins.daysWorked} of ${ins.expected} working days`}
          />
          <Kpi
            label="Hours logged"
            value={hoursLabel(ins.minutes)}
            note={ins.avgMinutes ? `${formatDuration(Math.round(ins.avgMinutes))} on an average day` : 'No completed days yet'}
          />
          <Kpi
            label="Average check-in"
            value={minutesToClock(ins.avgCheckIn)}
            note={checkIns.length ? `Across ${checkIns.length} day${checkIns.length === 1 ? '' : 's'}` : 'Check in to start tracking'}
          />
          <Kpi
            label="Streak"
            value={`${streak} day${streak === 1 ? '' : 's'}`}
            note="Working days in a row"
          />
        </div>
      </div>

      {/* ── charts ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <Panel title="Hours per day" note="dashed line = 8h">
          <HoursPerDayChart series={series} empty="No completed days this month yet. Check in and out and your hours will appear here." />
        </Panel>

        <Panel title="Days worked" note="last 6 months">
          <MonthsWorkedChart months={months} currentKey={monthKey} empty="Your monthly history builds up as you check in." />
        </Panel>
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'repeat(3, minmax(0, 1fr))' }}>
        <Panel title="Check-in time" note="this month">
          <CheckInChart points={checkIns} />
        </Panel>

        <Panel title="Leave balance" actions={<Btn size="sm" onClick={() => go('leave')}>Apply</Btn>}>
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            {balances.length ? balances.map((b) => {
              const total = Number(b.quota) + Number(b.adjusted);
              return (
                <div key={b.leave_type_id}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                    <span style={{ flex: 1, fontSize: 11.5, color: t.text }}>{b.leave_type_name}</span>
                    <span style={{ fontSize: 13, color: t.text }}>{Number(b.remaining)}</span>
                    <span style={{ fontSize: 9.5, color: t.faint }}>left of {total}</span>
                  </div>
                  <Bar value={Number(b.taken)} max={total || 1} />
                </div>
              );
            }) : <Empty>No leave types configured yet.</Empty>}
            {pending.length > 0 && (
              <div style={{ fontSize: 10, color: t.dim, borderTop: '1px solid ' + t.lineSoft, paddingTop: 10 }}>
                {pending.length} request{pending.length === 1 ? '' : 's'} waiting for a decision
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Coming up">
          <div style={{ padding: '4px 0' }}>
            {upcoming.slice(0, 2).map((r) => (
              <FeedRow key={r.id}
                dot={LEAVE_STATUSES.approved.color}
                title={`${typeName(r.leave_type_id)} leave`}
                meta={`${fmtLongDay(r.start_date)}${r.end_date !== r.start_date ? ` → ${fmtLongDay(r.end_date)}` : ''}`}
                onClick={() => go('leave')}
              />
            ))}
            {notices.slice(0, upcoming.length ? 2 : 4).map((a) => (
              <FeedRow key={a.id}
                dot={readIds.has(a.id) ? null : t.text}
                icon={a.is_pinned ? <Pin size={11} /> : null}
                title={a.title}
                meta={fmtLongDay(a.published_at)}
                onClick={() => go('announcements')}
              />
            ))}
            {!upcoming.length && !notices.length && <Empty>Nothing scheduled and nothing announced.</Empty>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, note, onClick, dot }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="edge-btn" style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9,
      border: '1px solid ' + t.line, background: t.panel, cursor: 'pointer', textAlign: 'left',
      fontFamily: MONO, color: t.text, minWidth: 0, position: 'relative',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0,
        background: t.panelAlt, border: '1px solid ' + t.lineSoft, color: t.dim,
      }}><Icon size={15} strokeWidth={1.8} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 11.5 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
      </span>
      {dot && <span style={{ position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: '50%', background: t.down }} />}
    </button>
  );
}

function FeedRow({ title, meta, dot, icon, onClick }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="edge-tr" style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px',
      background: 'transparent', border: 'none', borderBottom: '1px solid ' + t.lineSoft,
      cursor: 'pointer', textAlign: 'left', fontFamily: MONO,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot || 'transparent', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{icon}{title}</span>
        <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2 }}>{meta}</span>
      </span>
    </button>
  );
}
