import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, Download } from 'lucide-react';
import {
  Panel, Toolbar, Search, Seg, Btn, Table, Td, Tr, Empty, Loading, StatBand, Row,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { PlanTag, SubStatus } from './adminUi';
import { money, moneyShort, ago, fmtDate } from './adminUtils';
import OrgDetail from './OrgDetail';

/* Every tenant, one row each: who they are, how to reach them, what they pay
   and what they have earned. Opening a row is the whole record. */

const PLAN_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'max', label: 'Max' },
  { id: 'deleted', label: 'Deleted' },
];

const SORTS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'newest', label: 'Newest' },
  { id: 'active', label: 'Last seen' },
  { id: 'name', label: 'Name' },
];

export default function AdminOrgs({ orgs, loading, error, onChanged, onMailTo }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('all');
  const [sort, setSort] = useState('revenue');

  // Which tenant is open lives in the URL rather than in state: that is how
  // Overview links into a specific one (?open=<id>), it survives a reload, and
  // it means there is no second copy of the answer to keep in step.
  const openId = params.get('open');
  const setOpenId = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', id);
    else next.delete('open');
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = (orgs || [])
      .filter((o) => (plan === 'deleted' ? !!o.deletedAt : !o.deletedAt && (plan === 'all' || o.plan === plan)))
      .filter((o) => !q || [
        o.name, o.email, o.phone, o.owner?.email, o.owner?.name, o.industry, o.location, o.id,
      ].some((f) => String(f || '').toLowerCase().includes(q)));

    const by = {
      revenue: (a, b) => b.revenue.billed - a.revenue.billed,
      newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
      active: (a, b) => String(b.lastSignInAt || '').localeCompare(String(a.lastSignInAt || '')),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
    };
    return [...matched].sort(by[sort]);
  }, [orgs, query, plan, sort]);

  const shown = useMemo(() => rows.reduce((a, o) => ({
    billed: a.billed + o.revenue.billed,
    collected: a.collected + o.revenue.collected,
    outstanding: a.outstanding + o.revenue.outstanding,
    seats: a.seats + o.seats,
  }), { billed: 0, collected: 0, outstanding: 0, seats: 0 }), [rows]);

  const emails = useMemo(
    () => [...new Set(rows.map((o) => o.email || o.owner?.email).filter(Boolean))],
    [rows],
  );

  const exportCsv = () => {
    const head = ['Organisation', 'Owner', 'Email', 'Phone', 'Plan', 'Status', 'Seats',
      'Employees', 'Customers', 'Billed', 'Collected', 'Outstanding', 'Joined', 'Last seen'];
    const lines = rows.map((o) => [
      o.name, o.owner?.name, o.email || o.owner?.email, o.phone, o.plan, o.status, o.seats,
      o.employees, o.customers, o.revenue.billed, o.revenue.collected, o.revenue.outstanding,
      String(o.createdAt || '').slice(0, 10), String(o.lastSignInAt || '').slice(0, 10),
    ]);
    const csv = [head, ...lines]
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `edgeos-tenants-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <Panel><Empty>{error}</Empty></Panel>;
  if (loading && !orgs) return <Loading>Reading tenants…</Loading>;

  return (
    <>
      <Toolbar right={
        <Row gap={8}>
          <Btn size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download size={12} aria-hidden="true" /> CSV
          </Btn>
          <Btn size="sm" onClick={() => onMailTo(emails)} disabled={!emails.length}>
            <Mail size={12} aria-hidden="true" /> Mail these {emails.length}
          </Btn>
        </Row>
      }>
        <Search value={query} onChange={setQuery} placeholder="Name, email, phone, industry…" width={280} />
        <Seg value={plan} onChange={setPlan} options={PLAN_FILTERS} size="sm" label="Filter by plan" />
        <Seg value={sort} onChange={setSort} options={SORTS} size="sm" label="Sort by" />
      </Toolbar>

      <StatBand items={[
        { label: 'Showing', value: rows.length, note: `of ${(orgs || []).length} tenants` },
        { label: 'Seats', value: shown.seats },
        { label: 'Billed', value: moneyShort(shown.billed) },
        { label: 'Collected', value: moneyShort(shown.collected), tone: 'up' },
        { label: 'Outstanding', value: moneyShort(shown.outstanding), tone: shown.outstanding > 0 ? 'down' : undefined },
      ]} />

      <Table
        cols={[
          { key: 'org', label: 'Organisation' },
          { key: 'contact', label: 'Contact' },
          { key: 'plan', label: 'Plan', width: 80 },
          { key: 'status', label: 'Status', width: 100 },
          { key: 'seats', label: 'Seats', align: 'right', width: 60 },
          { key: 'billed', label: 'Billed', align: 'right', width: 112 },
          { key: 'out', label: 'Outstanding', align: 'right', width: 118 },
          { key: 'joined', label: 'Joined', align: 'right', width: 104 },
          { key: 'seen', label: 'Last seen', align: 'right', width: 92 },
        ]}
        empty={rows.length ? null : (
          <Empty action={query ? <Btn size="sm" onClick={() => setQuery('')}>Clear search</Btn> : null}>
            {query ? `Nothing matches “${query}”.` : 'No organisations in this view.'}
          </Empty>
        )}
      >
        {rows.map((o) => (
          <Tr key={o.id} label={`Open ${o.name}`} onClick={() => setOpenId(o.id)} selected={openId === o.id}>
            <Td>
              <span style={{ display: 'block', color: o.deletedAt ? t.faint : t.text }}>
                {o.name}
                {o.deletedAt && <span style={{ fontSize: 9, color: t.down, marginLeft: 7 }}>DELETED</span>}
              </span>
              <span style={{ display: 'block', fontSize: 9.5, color: t.ghost, marginTop: 2 }}>
                {[o.industry, o.location].filter(Boolean).join(' · ') || o.id.slice(0, 8)}
              </span>
            </Td>
            <Td muted>
              <span style={{ display: 'block' }}>{o.email || o.owner?.email || '—'}</span>
              <span style={{ display: 'block', fontSize: 9.5, color: t.ghost, marginTop: 2 }}>
                {o.owner?.name || o.phone || '—'}
              </span>
            </Td>
            <Td><PlanTag plan={o.plan} /></Td>
            <Td><SubStatus status={o.status} /></Td>
            <Td align="right" muted>{o.seats}</Td>
            <Td align="right" nowrap>{money(o.revenue.billed)}</Td>
            <Td align="right" nowrap>
              <span style={{ color: o.revenue.outstanding > 0 ? t.down : t.dim }}>
                {money(o.revenue.outstanding)}
              </span>
            </Td>
            <Td align="right" muted nowrap>{fmtDate(o.createdAt)}</Td>
            <Td align="right" muted nowrap>{ago(o.lastSignInAt)}</Td>
          </Tr>
        ))}
      </Table>

      {openId && (
        <OrgDetail
          key={openId}
          orgId={openId}
          summary={(orgs || []).find((o) => o.id === openId) || null}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onMailTo={onMailTo}
        />
      )}
    </>
  );
}
