import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel, Grid, StatBand, Breakdown, Table, Td, Tr, Empty, Loading, Btn } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { MonthBars, PlanTag } from './adminUi';
import { money, moneyShort, ago } from './adminUtils';

/* The platform on one screen: how many tenants exist, what they pay, what they
   have billed, and where the curve is going. Everything here is a link into
   Organisations — a number you cannot open is a number you cannot act on. */

export default function AdminOverview({ data, orgs, loading, error }) {
  const t = useT();
  const navigate = useNavigate();

  const top = useMemo(
    () => (orgs || []).filter((o) => !o.deletedAt).slice(0, 8),
    [orgs],
  );

  if (error) {
    return (
      <Panel>
        <Empty action={<Btn onClick={() => window.location.reload()}>Retry</Btn>}>
          {error}
        </Empty>
      </Panel>
    );
  }
  if (loading || !data) return <Loading>Reading the platform…</Loading>;

  const { totals, plans, series } = data;
  const collectionRate = totals.billed > 0 ? Math.round((totals.collected / totals.billed) * 100) : 0;

  return (
    <>
      <StatBand items={[
        { label: 'Organisations', value: totals.orgs, note: `${totals.newOrgs30d} new in 30 days` },
        { label: 'Users', value: totals.users, note: `${totals.activeUsers30d} active in 30 days` },
        { label: 'Billed', value: moneyShort(totals.billed), note: `${totals.invoices} invoices issued` },
        { label: 'Collected', value: moneyShort(totals.collected), note: `${collectionRate}% of billed`, tone: 'up' },
        { label: 'Outstanding', value: moneyShort(totals.outstanding), note: `${moneyShort(totals.overdue)} overdue`, tone: totals.outstanding > 0 ? 'down' : undefined },
      ]} />

      <Grid cols="minmax(0, 2fr) minmax(260px, 1fr)" gap={14}>
        <Panel title="Revenue across all tenants" note="last 12 months" pad={16}>
          <MonthBars series={series} height={150} />
        </Panel>

        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <Panel title="Plan mix" pad={14}>
            <Breakdown
              rows={[
                { label: 'Free', value: plans.free },
                { label: 'Pro', value: plans.pro },
                { label: 'Max', value: plans.max },
              ]}
              total={plans.free + plans.pro + plans.max}
            />
          </Panel>

          <Panel title="Signups" note="last 12 months" pad={14}>
            <MonthBars
              series={series} height={86}
              keys={['signups']} labels={['New organisations']}
            />
          </Panel>
        </div>
      </Grid>

      <div style={{ height: 14 }} />

      <Panel
        title="Top tenants by revenue"
        actions={<Btn size="sm" onClick={() => navigate('/admin/orgs')}>See all</Btn>}
      >
        <Table
          cols={[
            { key: 'name', label: 'Organisation' },
            { key: 'plan', label: 'Plan', width: 78 },
            { key: 'seats', label: 'Seats', align: 'right', width: 62 },
            { key: 'billed', label: 'Billed', align: 'right', width: 116 },
            { key: 'collected', label: 'Collected', align: 'right', width: 116 },
            { key: 'out', label: 'Outstanding', align: 'right', width: 122 },
            { key: 'seen', label: 'Last seen', align: 'right', width: 96 },
          ]}
          empty={top.length ? null : <Empty>No organisations yet.</Empty>}
        >
          {top.map((o) => (
            <Tr key={o.id} label={o.name} onClick={() => navigate(`/admin/orgs?open=${o.id}`)}>
              <Td>
                <span style={{ display: 'block' }}>{o.name}</span>
                <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2 }}>
                  {o.owner.email || '—'}
                </span>
              </Td>
              <Td><PlanTag plan={o.plan} /></Td>
              <Td align="right" muted>{o.seats}</Td>
              <Td align="right" nowrap>{money(o.revenue.billed)}</Td>
              <Td align="right" nowrap muted>{money(o.revenue.collected)}</Td>
              <Td align="right" nowrap>
                <span style={{ color: o.revenue.outstanding > 0 ? t.down : t.dim }}>
                  {money(o.revenue.outstanding)}
                </span>
              </Td>
              <Td align="right" muted nowrap>{ago(o.lastSignInAt)}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
