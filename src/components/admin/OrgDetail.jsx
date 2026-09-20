import { useEffect, useState } from 'react';
import { Mail, Trash2, RotateCcw, Check } from 'lucide-react';
import {
  Modal, Panel, Grid, Seg, Btn, Select, Field, Input, Table, Td, Tr, Empty, Loading,
  StatBand, Status, Row, ConfirmBtn,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { adminService } from '../../services/adminService';
import { useToast } from '../shared/Toast';
import { MonthBars, PlanTag, SubStatus, KeyVal, Link } from './adminUi';
import { money, moneyShort, ago, fmtDate } from './adminUtils';

/* One tenant, completely: the company record, every person who can sign in,
   the money, the documents, and the two controls that change anything — the
   plan and the soft delete. Tabs rather than one long sheet, because the
   question you open this with is usually one of four. */

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'people', label: 'People' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'activity', label: 'Activity' },
  { id: 'plan', label: 'Plan' },
];

export default function OrgDetail({ orgId, summary, onClose, onChanged, onMailTo }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState('profile');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // AdminOrgs keys this component by orgId, so a different tenant is a fresh
  // mount with fresh state — there is nothing to reset here.
  useEffect(() => {
    let cancelled = false;
    adminService.orgDetail(orgId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load this organisation.'); });
    return () => { cancelled = true; };
  }, [orgId]);

  const org = data?.org;
  const title = org?.company_name || summary?.name || 'Organisation';

  return (
    <Modal
      open onClose={onClose} width={900}
      title={title}
      note={org ? [org.industry, [org.city, org.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || org.id : orgId}
      footer={
        <Row gap={8}>
          <div style={{ flex: 1 }} />
          {data && (
            <Btn size="sm" onClick={() => onMailTo(mailTargets(data))}>
              <Mail size={12} aria-hidden="true" /> Email this tenant
            </Btn>
          )}
          <Btn size="sm" onClick={onClose}>Close</Btn>
        </Row>
      }
    >
      {error && <Empty>{error}</Empty>}
      {!error && !data && <Loading>Reading this organisation…</Loading>}

      {data && (
        <>
          <div style={{ marginBottom: 14 }}>
            <Seg value={tab} onChange={setTab} options={TABS} size="sm" label="Section" />
          </div>

          {tab === 'profile' && <ProfileTab t={t} data={data} />}
          {tab === 'people' && <PeopleTab t={t} data={data} onMailTo={onMailTo} />}
          {tab === 'revenue' && <RevenueTab t={t} data={data} />}
          {tab === 'activity' && <ActivityTab data={data} />}
          {tab === 'plan' && (
            <PlanTab
              t={t} data={data} toast={toast}
              deletedAt={org.deleted_at}
              onSaved={(next) => {
                setData((d) => ({ ...d, org: { ...d.org, subscription: { ...d.org.subscription, ...next } } }));
                onChanged();
              }}
              onLifecycle={(deletedAt) => {
                setData((d) => ({ ...d, org: { ...d.org, deleted_at: deletedAt } }));
                onChanged();
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/** Every address the console would reasonably write to for this tenant. */
function mailTargets(data) {
  return [...new Set([
    data.org.company_email,
    ...data.members.map((m) => m.email),
  ].filter(Boolean))];
}

/* ── profile ──────────────────────────────────────────────────────────────── */

function ProfileTab({ t, data }) {
  const { org } = data;
  const b = org.banking;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel title="Contact" pad={14}>
        <Grid min={180} gap={14}>
          <KeyVal label="Company">{org.company_name}</KeyVal>
          <KeyVal label="Email">
            <Link href={org.company_email ? `mailto:${org.company_email}` : null}>{org.company_email}</Link>
          </KeyVal>
          <KeyVal label="Phone">
            <Link href={org.company_phone ? `tel:${org.company_phone}` : null}>{org.company_phone}</Link>
          </KeyVal>
          <KeyVal label="Website">
            <Link href={org.company_website}>{org.company_website}</Link>
          </KeyVal>
          <KeyVal label="Primary contact">{org.primary_contact_name}</KeyVal>
          <KeyVal label="Address">{org.company_address}</KeyVal>
        </Grid>
      </Panel>

      <Panel title="Company" pad={14}>
        <Grid min={150} gap={14}>
          <KeyVal label="Owner">{org.owner_full_name}</KeyVal>
          <KeyVal label="Owner role">{org.owner_role}</KeyVal>
          <KeyVal label="Industry">{org.industry}</KeyVal>
          <KeyVal label="Size">{org.company_size}</KeyVal>
          <KeyVal label="Location">{[org.city, org.country].filter(Boolean).join(', ')}</KeyVal>
          <KeyVal label="Joined">{fmtDate(org.created_at)}</KeyVal>
          <KeyVal label="Referral">{org.referral_source}</KeyVal>
          <KeyVal label="Org ID" mono>{org.id}</KeyVal>
        </Grid>
        {org.company_description && (
          <p style={{ margin: '14px 0 0', fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
            {org.company_description}
          </p>
        )}
      </Panel>

      <Panel title="Billing identity" note="read only" pad={14}>
        {b ? (
          <Grid min={150} gap={14}>
            <KeyVal label="GSTIN" mono>{b.gstin}</KeyVal>
            <KeyVal label="CIN" mono>{b.cin}</KeyVal>
            <KeyVal label="UPI" mono>{b.upi_id}</KeyVal>
            <KeyVal label="Bank">{b.bank_name}</KeyVal>
            <KeyVal label="IFSC" mono>{b.bank_ifsc}</KeyVal>
            <KeyVal label="Account type">{b.bank_account_type}</KeyVal>
          </Grid>
        ) : <Empty>No billing details on file.</Empty>}
      </Panel>
    </div>
  );
}

/* ── people ───────────────────────────────────────────────────────────────── */

function PeopleTab({ t, data, onMailTo }) {
  const { members, employees, customers } = data;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title="Accounts" note={`${members.length} can sign in`}
        actions={
          <Btn size="sm" onClick={() => onMailTo(members.map((m) => m.email).filter(Boolean))}
            disabled={!members.some((m) => m.email)}>
            <Mail size={12} aria-hidden="true" /> Email all
          </Btn>
        }
      >
        <Table
          cols={[
            { key: 'who', label: 'Person' },
            { key: 'role', label: 'Role', width: 88 },
            { key: 'state', label: 'State', width: 108 },
            { key: 'joined', label: 'Joined', align: 'right', width: 104 },
            { key: 'seen', label: 'Last seen', align: 'right', width: 92 },
          ]}
          empty={members.length ? null : <Empty>No accounts.</Empty>}
        >
          {members.map((m) => (
            <Tr key={m.id}>
              <Td>
                <span style={{ display: 'block' }}>{m.email || m.id.slice(0, 8)}</span>
                <span style={{ display: 'block', fontSize: 9.5, color: t.ghost, marginTop: 2 }}>
                  {m.name || '—'}{m.isOwner && ' · owner'}
                </span>
              </Td>
              <Td muted>{m.role}</Td>
              <Td>
                <Status tone={m.confirmed ? 'up' : 'mute'}>
                  {m.confirmed ? 'confirmed' : 'unconfirmed'}
                </Status>
              </Td>
              <Td align="right" muted nowrap>{fmtDate(m.joinedAt)}</Td>
              <Td align="right" muted nowrap>{ago(m.lastSignInAt)}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Grid cols="1fr 1fr" gap={14}>
        <Panel title="Team" note={`${employees.filter((e) => !e.exited_at).length} active`}>
          <Table
            cols={[{ key: 'n', label: 'Name' }, { key: 'r', label: 'Role' }]}
            empty={employees.length ? null : <Empty>No employees.</Empty>}
          >
            {employees.slice(0, 12).map((e) => (
              <Tr key={e.id}>
                <Td>
                  <span style={{ color: e.exited_at ? t.faint : t.text }}>{e.full_name}</span>
                  <span style={{ display: 'block', fontSize: 9.5, color: t.ghost, marginTop: 2 }}>
                    {e.email || '—'}
                  </span>
                </Td>
                <Td muted>{e.exited_at ? 'exited' : (e.role || '—')}</Td>
              </Tr>
            ))}
          </Table>
        </Panel>

        <Panel title="Their customers" note={`${customers.length} on file`}>
          <Table
            cols={[{ key: 'n', label: 'Name' }, { key: 'c', label: 'Contact' }]}
            empty={customers.length ? null : <Empty>No customers.</Empty>}
          >
            {customers.slice(0, 12).map((c) => (
              <Tr key={c.id}>
                <Td>{c.name}</Td>
                <Td muted>{c.email || c.phone || '—'}</Td>
              </Tr>
            ))}
          </Table>
        </Panel>
      </Grid>
    </div>
  );
}

/* ── revenue ──────────────────────────────────────────────────────────────── */

function RevenueTab({ t, data }) {
  const { revenue, documents, payments } = data;
  const net = revenue.collected - revenue.expenses;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatBand items={[
        { label: 'Billed', value: moneyShort(revenue.billed), note: `${revenue.invoices} invoices` },
        { label: 'Collected', value: moneyShort(revenue.collected), tone: 'up', note: `${revenue.paidInvoices} settled` },
        { label: 'Outstanding', value: moneyShort(revenue.outstanding), tone: revenue.outstanding > 0 ? 'down' : undefined, note: `${moneyShort(revenue.overdue)} overdue` },
        { label: 'Expenses', value: moneyShort(revenue.expenses) },
        { label: 'Net', value: moneyShort(net), tone: net >= 0 ? 'up' : 'down' },
      ]} />

      <Panel title="Monthly" note="billed against collected, last 12 months" pad={16}>
        <MonthBars series={revenue.series} height={130} />
      </Panel>

      <Panel title="Documents" note={`${documents.length} most recent`}>
        <Table
          cols={[
            { key: 'no', label: 'Number', width: 130 },
            { key: 'ty', label: 'Type', width: 82 },
            { key: 'to', label: 'Billed to' },
            { key: 'st', label: 'Status', width: 110 },
            { key: 'am', label: 'Total', align: 'right', width: 108 },
            { key: 'pd', label: 'Paid', align: 'right', width: 108 },
            { key: 'dt', label: 'Issued', align: 'right', width: 104 },
          ]}
          empty={documents.length ? null : <Empty>No financial documents yet.</Empty>}
        >
          {documents.map((d) => (
            <Tr key={d.id}>
              <Td nowrap>{d.doc_number}</Td>
              <Td muted>{d.type}</Td>
              <Td muted>
                <span style={{ display: 'block' }}>{d.bill_to_name}</span>
                {d.bill_to_email && (
                  <span style={{ display: 'block', fontSize: 9.5, color: t.ghost, marginTop: 2 }}>{d.bill_to_email}</span>
                )}
              </Td>
              <Td>
                <Status tone={
                  d.status === 'paid' ? 'up'
                    : d.status === 'overdue' ? 'down'
                      : d.status === 'draft' || d.status === 'void' ? 'mute' : 'neutral'
                }>{String(d.status).replace('_', ' ')}</Status>
              </Td>
              <Td align="right" nowrap>{money(d.grand_total)}</Td>
              <Td align="right" nowrap muted>{money(d.amount_paid)}</Td>
              <Td align="right" nowrap muted>{fmtDate(d.issue_date)}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Payments received" note={`${payments.length} most recent`}>
        <Table
          cols={[
            { key: 'd', label: 'Date', width: 120 },
            { key: 'm', label: 'Method' },
            { key: 'r', label: 'Reference' },
            { key: 'a', label: 'Amount', align: 'right', width: 116 },
          ]}
          empty={payments.length ? null : <Empty>No payments recorded.</Empty>}
        >
          {payments.map((p, i) => (
            <Tr key={`${p.paid_on}-${p.reference || i}`}>
              <Td nowrap muted>{fmtDate(p.paid_on)}</Td>
              <Td muted>{p.method || '—'}</Td>
              <Td muted>{p.reference || '—'}</Td>
              <Td align="right" nowrap>{money(p.amount)}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

/* ── activity ─────────────────────────────────────────────────────────────── */

function ActivityTab({ data }) {
  const { audit, org } = data;
  const u = org.usage;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel title="Usage against plan" pad={14}>
        {u ? (
          <Grid min={120} gap={14}>
            <KeyVal label="Offer letters">{u.offer_letters}</KeyVal>
            <KeyVal label="Certificates">{u.certificates}</KeyVal>
            <KeyVal label="NDAs">{u.nda}</KeyVal>
            <KeyVal label="MoUs">{u.mou}</KeyVal>
            <KeyVal label="Invoices">{u.invoices}</KeyVal>
            <KeyVal label="Quotations">{u.quotations}</KeyVal>
            <KeyVal label="Proformas">{u.proformas}</KeyVal>
          </Grid>
        ) : <Empty>No usage counters yet.</Empty>}
      </Panel>

      <Panel title="Audit trail" note="40 most recent">
        <Table
          cols={[
            { key: 'w', label: 'When', width: 150 },
            { key: 'a', label: 'Action' },
            { key: 'e', label: 'Entity', width: 140 },
          ]}
          empty={audit.length ? null : <Empty>Nothing recorded yet.</Empty>}
        >
          {audit.map((a, i) => (
            <Tr key={`${a.created_at}-${i}`}>
              <Td nowrap muted>{new Date(a.created_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}</Td>
              <Td>{a.action}</Td>
              <Td muted>{a.entity_type || '—'}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

/* ── plan ─────────────────────────────────────────────────────────────────── */

const PLAN_OPTIONS = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'max', label: 'Max' },
];
const STATUS_OPTIONS = ['active', 'trialing', 'past_due', 'paused', 'cancelled'];

function PlanTab({ t, data, toast, deletedAt, onSaved, onLifecycle }) {
  const sub = data.org.subscription;
  const orgId = data.org.id;

  const [plan, setPlan] = useState(sub.plan || 'free');
  const [status, setStatus] = useState(sub.status || 'active');
  const [periodEnd, setPeriodEnd] = useState((sub.current_period_end || '').slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = plan !== (sub.plan || 'free')
    || status !== (sub.status || 'active')
    || periodEnd !== (sub.current_period_end || '').slice(0, 10);

  const save = async () => {
    setSaving(true);
    try {
      await adminService.setPlan(orgId, plan, status, periodEnd || null);
      toast(`${data.org.company_name} is now on ${plan}`, 'success');
      onSaved({ plan, status, current_period_end: periodEnd || null });
    } catch (err) {
      toast(err.message || 'Could not change the plan', 'error');
    } finally {
      setSaving(false);
    }
  };

  const lifecycle = async (restore) => {
    setBusy(true);
    try {
      if (restore) await adminService.restoreOrg(orgId);
      else await adminService.deleteOrg(orgId);
      toast(restore ? 'Organisation restored' : 'Organisation deleted', 'success');
      onLifecycle(restore ? null : new Date().toISOString());
    } catch (err) {
      toast(err.message || 'Could not update the organisation', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel title="Subscription" pad={14}>
        <Row gap={14} wrap style={{ marginBottom: 16 }}>
          <KeyVal label="Current plan"><PlanTag plan={sub.plan} /></KeyVal>
          <KeyVal label="Current status"><SubStatus status={sub.status} /></KeyVal>
          <KeyVal label="Renews">{sub.current_period_end ? fmtDate(sub.current_period_end) : 'no end date'}</KeyVal>
          <KeyVal label="Changed">{sub.updated_at ? ago(sub.updated_at) : '—'}</KeyVal>
        </Row>

        <div style={{ display: 'grid', gap: 13, maxWidth: 460 }}>
          <Field label="Plan" hint="Takes effect immediately for every member of this tenant.">
            <div style={{ marginTop: 2 }}>
              <Seg value={plan} onChange={setPlan} options={PLAN_OPTIONS} label="Plan" />
            </div>
          </Field>

          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </Select>
          </Field>

          <Field label="Period end" hint="Optional. Leave blank for an open-ended subscription.">
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>

          <Row gap={8}>
            <Btn primary onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : <><Check size={12} aria-hidden="true" /> Apply changes</>}
            </Btn>
            {dirty && !saving && (
              <Btn onClick={() => {
                setPlan(sub.plan || 'free');
                setStatus(sub.status || 'active');
                setPeriodEnd((sub.current_period_end || '').slice(0, 10));
              }}>Reset</Btn>
            )}
          </Row>
        </div>
      </Panel>

      <Panel title="Lifecycle" pad={14}>
        {deletedAt ? (
          <Row gap={12} wrap>
            <div style={{ flex: 1, minWidth: 220, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
              Deleted {ago(deletedAt)}. The rows are intact — restoring makes the
              workspace visible to its members again.
            </div>
            <Btn onClick={() => lifecycle(true)} disabled={busy}>
              <RotateCcw size={12} aria-hidden="true" /> Restore
            </Btn>
          </Row>
        ) : (
          <Row gap={12} wrap>
            <div style={{ flex: 1, minWidth: 220, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
              A soft delete. The tenant disappears from every member's app at once,
              and nothing is erased — you can restore it from this same panel.
            </div>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Trash2 size={12} aria-hidden="true" style={{ color: t.down }} />
              <ConfirmBtn
                size="md" label="Delete organisation" confirmLabel="Confirm delete"
                onConfirm={() => lifecycle(false)}
              />
            </span>
          </Row>
        )}
      </Panel>
    </div>
  );
}
