// EmployeePortal.jsx — what an employee sees when they sign in.
//
// Deliberately not the admin shell: no org switcher and no modules, just the
// five places a person goes for themselves. It wears the same terminal theme
// (theme/edge.js) so it reads as the same product. Every read and write here
// is one an `employee` role may make on their OWN rows (0029 §6 `*_self_*`
// policies, 0032 update_my_profile); this component holds no authority of its
// own, so a person who reaches it with a different role sees exactly what the
// database gives them and nothing more.
//
// Layout, for reach: navigation on a rail at the left (a bar along the bottom
// on a phone, under the thumb), and check-in/out always in the top bar, since
// it is the one thing people do here every single day.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, Plane, Megaphone, UserRound, LogIn, LogOut, Sun, Moon,
  ArrowLeft, UserCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { useTheme } from '../../hooks/useTheme';
import { EdgeThemeContext } from '../../theme/EdgeTheme';
import { makeTokens, MONO } from '../../theme/edge';
import { Page, Btn, Loading, Empty } from '../ui/edge';
import { meService } from '../../services/meService';
import { announcementService } from '../../services/announcementService';
import { leaveService } from '../../services/leaveService';
import { attendanceService, todayKey, currentMonthKey } from '../../services/attendanceService';
import { PhotoAvatar } from './me/portalKit';
import { recentMonths, clockTime, useWindowWidth, monthLabel } from './me/portalUtils';
import OverviewTab from './me/OverviewTab';
import AttendanceTab from './me/AttendanceTab';
import LeaveTab from './me/LeaveTab';
import AnnouncementsTab from './me/AnnouncementsTab';
import ProfileTab, { ChangePassword } from './me/ProfileTab';

const TABS = [
  { id: 'overview',      label: 'Overview',      short: 'Home',    icon: LayoutDashboard, sub: 'Your day and your month at a glance' },
  { id: 'attendance',    label: 'Attendance',    short: 'Days',    icon: CalendarDays,    sub: 'Every day you have checked in' },
  { id: 'leave',         label: 'Leave',         short: 'Leave',   icon: Plane,           sub: 'Balances, requests and decisions' },
  { id: 'announcements', label: 'Announcements', short: 'News',    icon: Megaphone,       sub: 'What your workplace wants you to know' },
  { id: 'profile',       label: 'My profile',    short: 'Profile', icon: UserRound,       sub: 'Your photo, details and password' },
];

export default function EmployeePortal() {
  const { user, logout } = useAuth();
  const { activeOrg } = useOrg();
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();
  const t = makeTokens(theme === 'dark');
  const orgId = activeOrg?.id;
  const width = useWindowWidth();
  const mobile = width < 760;
  const narrow = width < 1080;

  const [tab, setTab] = useState('overview');
  const [me, setMe] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(null);
  const [balances, setBalances] = useState([]);
  const [types, setTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notices, setNotices] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  // Attendance by month key, then by date. The overview draws the last six
  // months from it and the attendance tab adds older months as it browses.
  const [history, setHistory] = useState({});
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [monthLoading, setMonthLoading] = useState(false);
  const [clocking, setClocking] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [employee, myRole] = await Promise.all([
        meService.getMyEmployee(orgId),
        meService.getMyRole(orgId).catch(() => null),
      ]);
      setRole(myRole);
      if (!employee) { setMe(null); return; }

      const months = recentMonths(6);
      const [ty, r, b, day, live, read, ...monthRows] = await Promise.all([
        leaveService.listTypes(orgId),
        leaveService.listRequests(orgId, { employeeId: employee.id }),
        leaveService.balances(orgId, employee.id),
        attendanceService.getDay(orgId, employee.id, todayKey()),
        announcementService.list(orgId),
        announcementService.readIds(),
        ...months.map((k) => attendanceService.listMonth(orgId, employee.id, k).catch(() => ({}))),
      ]);
      setTypes(ty); setRequests(r); setBalances(b);
      setToday(day); setNotices(live); setReadIds(read);
      setHistory(Object.fromEntries(months.map((k, i) => [k, monthRows[i]])));
      // Last, so the month effect below sees the six months already held and
      // does not fetch the current one a second time.
      setMe(employee);
    } catch (err) {
      toast(err.message || 'Could not load your portal.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Fetch a month the attendance tab browses to that is not already held.
  useEffect(() => {
    if (!orgId || !me?.id || history[monthKey]) return;
    let cancelled = false;
    setMonthLoading(true);
    attendanceService.listMonth(orgId, me.id, monthKey)
      .then((rows) => { if (!cancelled) setHistory((h) => ({ ...h, [monthKey]: rows })); })
      .catch(() => { if (!cancelled) setHistory((h) => ({ ...h, [monthKey]: {} })); })
      .finally(() => { if (!cancelled) setMonthLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, me?.id, monthKey, history]);

  const refreshBalances = useCallback(async () => {
    if (!orgId || !me?.id) return;
    try { setBalances(await leaveService.balances(orgId, me.id)); } catch { /* the list still shows */ }
  }, [orgId, me?.id]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const clock = async (direction) => {
    setClocking(true);
    try {
      const row = direction === 'in'
        ? await attendanceService.checkIn(orgId, me.id)
        : await attendanceService.checkOut(orgId, me.id);
      setToday(row);
      const mk = row.work_date.slice(0, 7);
      setHistory((h) => ({ ...h, [mk]: { ...(h[mk] || {}), [row.work_date]: row } }));
      toast(direction === 'in' ? `Checked in at ${clockTime(row.check_in)}` : `Checked out at ${clockTime(row.check_out)}`, 'success');
    } catch (err) {
      toast(err.message || 'Could not record that.', 'error');
    } finally {
      setClocking(false);
    }
  };

  const unread = useMemo(() => notices.filter((a) => !readIds.has(a.id)).length, [notices, readIds]);

  const markRead = useCallback(async (id) => {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set(prev).add(id));
    try {
      await announcementService.markRead(id);
    } catch { /* a failed read receipt is not worth interrupting anyone over */ }
  }, [readIds]);

  const go = (id) => {
    setTab(id);
    document.getElementById('me-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const typeName = (id) => types.find((x) => x.id === id)?.name || 'Leave';
  const current = TABS.find((x) => x.id === tab) || TABS[0];
  const orgName = activeOrg?.company_name || activeOrg?.name || 'Workspace';

  // ── Frame ──────────────────────────────────────────────────────────────────
  const frame = (body) => (
    <EdgeThemeContext.Provider value={theme}>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 100, background: t.shell, color: t.text,
        fontFamily: MONO, WebkitFontSmoothing: 'antialiased',
      }}>
        {/* Page brings the kit's hover and focus styles with it. */}
        <Page>{body}</Page>
      </div>
    </EdgeThemeContext.Provider>
  );

  if (loading) {
    return frame(<div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><Loading>Loading your portal…</Loading></div>);
  }

  if (!me) {
    return frame(
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div style={{ maxWidth: 420, border: '1px solid ' + t.line, borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <UserCircle size={28} style={{ color: t.faint }} />
          <div style={{ fontSize: 14, margin: '10px 0 8px' }}>Your employee record isn&rsquo;t linked yet</div>
          <Empty>
            Your sign-in works, but no employee record in {orgName} is connected to it — so there is no
            attendance or leave to show. Ask an admin to link your record from the Employees page.
          </Empty>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {role && role !== 'employee' && <Link to="/hub" style={{ textDecoration: 'none' }}><Btn><ArrowLeft size={13} /> Back to hub</Btn></Link>}
            <Btn onClick={logout}><LogOut size={13} /> Sign out</Btn>
          </div>
        </div>
      </div>,
    );
  }

  const inAt = today?.check_in;
  const outAt = today?.check_out;

  return frame(
      <div style={{ height: '100vh', display: 'flex', overflow: 'hidden', background: t.shell }}>
        {/* ── rail ───────────────────────────────────────────────────────── */}
        {!mobile && (
          <aside style={{
            width: narrow ? 64 : 224, flexShrink: 0, background: t.panel, borderRight: '1px solid ' + t.line,
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              height: 57, display: 'flex', alignItems: 'center', gap: 10, padding: narrow ? '0 16px' : '0 16px',
              borderBottom: '1px solid ' + t.line, flexShrink: 0,
            }}>
              {activeOrg?.logo_url ? (
                <img src={activeOrg.logo_url} alt="" style={{ width: 30, height: 30, borderRadius: 7, objectFit: 'cover' }} />
              ) : (
                <span style={{
                  width: 30, height: 30, borderRadius: 7, background: t.selBg, color: t.selText, flexShrink: 0,
                  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600,
                }}>{orgName.slice(0, 2).toUpperCase()}</span>
              )}
              {!narrow && (
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgName}</span>
                  <span style={{ display: 'block', fontSize: 9, letterSpacing: '0.1em', color: t.faint, marginTop: 2 }}>EMPLOYEE PORTAL</span>
                </span>
              )}
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 9px' }}>
              {TABS.map((x) => {
                const active = x.id === tab;
                const badge = x.id === 'announcements' ? unread : 0;
                return (
                  <button
                    key={x.id} type="button" onClick={() => go(x.id)} title={x.label}
                    aria-current={active ? 'page' : undefined}
                    className="edge-seg"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, height: 38, padding: narrow ? 0 : '0 10px',
                      justifyContent: narrow ? 'center' : 'flex-start', position: 'relative',
                      border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: MONO, fontSize: 12,
                      background: active ? t.panelAlt : 'transparent', color: active ? t.text : t.dim,
                      boxShadow: active ? 'inset 2px 0 0 ' + t.text : 'none',
                    }}
                  >
                    <x.icon size={16} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                    {!narrow && <span style={{ flex: 1, textAlign: 'left' }}>{x.label}</span>}
                    {badge > 0 && (
                      <span style={narrow ? {
                        position: 'absolute', top: 7, right: 12, width: 7, height: 7, borderRadius: '50%', background: t.down,
                      } : {
                        fontSize: 9.5, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, boxSizing: 'border-box',
                        display: 'grid', placeItems: 'center', background: t.selBg, color: t.selText,
                      }}>{narrow ? '' : badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div style={{ flex: 1 }} />

            <div style={{ padding: 9, borderTop: '1px solid ' + t.line, display: 'grid', gap: 2 }}>
              {role && role !== 'employee' && (
                <Link to="/hub" title="Back to hub" className="edge-seg" style={railLink(t, narrow)}>
                  <ArrowLeft size={15} strokeWidth={1.8} />{!narrow && 'Back to hub'}
                </Link>
              )}
              <button type="button" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} className="edge-seg" style={railLink(t, narrow)}>
                {theme === 'dark' ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
                {!narrow && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
              </button>
              <button type="button" onClick={logout} title="Sign out" className="edge-seg" style={{ ...railLink(t, narrow), color: t.down }}>
                <LogOut size={15} strokeWidth={1.8} />{!narrow && 'Sign out'}
              </button>
            </div>
          </aside>
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* ── top bar ──────────────────────────────────────────────────── */}
          <header style={{
            height: 57, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
            padding: mobile ? '0 12px' : '0 22px', background: t.panel, borderBottom: '1px solid ' + t.line,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{ margin: 0, fontSize: mobile ? 14 : 15, fontWeight: 500, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {current.label}
              </h1>
              {!mobile && <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>{current.id === 'attendance' ? monthLabel(monthKey) : current.sub}</div>}
            </div>

            {/* Check-in lives here on every tab. Hidden once the day is closed. */}
            {!outAt && (
              <Btn primary onClick={() => clock(inAt ? 'out' : 'in')} disabled={clocking} title={inAt ? `Checked in at ${clockTime(inAt)}` : 'Start your day'}>
                {inAt ? <LogOut size={13} /> : <LogIn size={13} />}
                {clocking ? 'Saving…' : inAt ? (mobile ? 'Out' : `Check out · in since ${clockTime(inAt)}`) : (mobile ? 'In' : 'Check in')}
              </Btn>
            )}

            {mobile && (
              <>
                <button type="button" onClick={toggleTheme} aria-label="Toggle theme" style={iconBtn(t)}>
                  {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <button type="button" onClick={logout} aria-label="Sign out" style={{ ...iconBtn(t), color: t.down }}>
                  <LogOut size={15} />
                </button>
              </>
            )}

            <button type="button" onClick={() => go('profile')} title="My profile" className="edge-btn" style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: mobile ? 2 : '3px 10px 3px 3px', borderRadius: 9,
              border: '1px solid ' + (tab === 'profile' ? t.lineStrong : t.line), background: t.panelAlt,
              cursor: 'pointer', fontFamily: MONO, color: t.text,
            }}>
              <PhotoAvatar name={me.full_name} path={me.photo_path} size={30} radius={7} />
              {!mobile && (
                <span style={{ textAlign: 'left', lineHeight: 1.25, maxWidth: 150 }}>
                  <span style={{ display: 'block', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.full_name}</span>
                  <span style={{ display: 'block', fontSize: 9, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</span>
                </span>
              )}
            </button>
          </header>

          {/* ── body ─────────────────────────────────────────────────────── */}
          <main id="me-scroll" className="edge-scroll" style={{
            flex: 1, minHeight: 0, overflowY: 'auto', background: t.shell,
            padding: mobile ? '14px 12px 84px' : '22px 24px 40px',
          }}>
            <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gap: 16 }}>
              {/* Above every tab, not inside one: a person still on a password
                  their admin generated should meet this first. */}
              {me.portal_must_change_password && (
                <ChangePassword mustChange onDone={() => setMe((m) => ({ ...m, portal_must_change_password: false }))} />
              )}

              {tab === 'overview' && (
                <OverviewTab
                  me={me} today={today} clocking={clocking} onClock={clock} balances={balances}
                  history={history} requests={requests} notices={notices} readIds={readIds}
                  typeName={typeName} go={go} narrow={narrow}
                />
              )}
              {tab === 'attendance' && (
                <AttendanceTab
                  monthKey={monthKey} setMonthKey={setMonthKey} rows={history[monthKey]}
                  loading={monthLoading && !history[monthKey]} narrow={mobile}
                />
              )}
              {tab === 'leave' && (
                <LeaveTab
                  orgId={orgId} me={me} types={types} balances={balances} requests={requests}
                  setRequests={setRequests} toast={toast} onChanged={refreshBalances} narrow={narrow}
                />
              )}
              {tab === 'announcements' && <AnnouncementsTab notices={notices} readIds={readIds} onOpen={markRead} />}
              {tab === 'profile' && <ProfileTab orgId={orgId} me={me} setMe={setMe} email={user?.email} narrow={narrow} />}
            </div>
          </main>
        </div>

        {/* ── phone: navigation under the thumb ─────────────────────────── */}
        {mobile && (
          <nav style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, display: 'grid',
            gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, background: t.panel, borderTop: '1px solid ' + t.line,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}>
            {TABS.map((x) => {
              const active = x.id === tab;
              return (
                <button key={x.id} type="button" onClick={() => go(x.id)} aria-current={active ? 'page' : undefined} style={{
                  height: 60, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                  color: active ? t.text : t.faint, fontFamily: MONO, fontSize: 9.5,
                  boxShadow: active ? 'inset 0 2px 0 ' + t.text : 'none',
                }}>
                  <x.icon size={18} strokeWidth={active ? 2 : 1.7} />
                  {x.short}
                  {x.id === 'announcements' && unread > 0 && (
                    <span style={{ position: 'absolute', top: 10, left: '58%', width: 7, height: 7, borderRadius: '50%', background: t.down }} />
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>,
  );
}

function railLink(t, narrow) {
  return {
    display: 'flex', alignItems: 'center', gap: 12, height: 34, padding: narrow ? 0 : '0 10px',
    justifyContent: narrow ? 'center' : 'flex-start', borderRadius: 8, border: 'none', background: 'transparent',
    cursor: 'pointer', fontFamily: MONO, fontSize: 11.5, color: t.dim, textDecoration: 'none',
  };
}

function iconBtn(t) {
  return {
    width: 32, height: 32, display: 'grid', placeItems: 'center', flexShrink: 0, cursor: 'pointer',
    border: '1px solid ' + t.line, background: t.panelAlt, color: t.dim, borderRadius: 8,
  };
}
