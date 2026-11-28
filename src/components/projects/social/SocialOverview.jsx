import React, { useMemo, useState } from 'react';
import { Panel, Row, Btn, Empty, Muted, Status, StatBand, Bar } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { money, fmtDate } from '../../financial/financeHooks';
import { canSeeFinancials } from '../../../services/projectService';
import {
    postStatusOf, awaitingApproval, campaignKindOf, launchStatusOf, readiness, timeOf, count, change, latestFigures, sumOf, monthLabel,
} from './socialModel';
import { useProjectRows } from './socialHooks';
import { PlatformDots } from './socialUi';

/* ══════════════════════════════════════════════════════════════════════════
   Social › Overview: the project's social work at a glance. What goes out
   in the next two weeks, what is waiting for a yes, which campaigns are
   live and what they cost, the next launch, and the latest audience.
   ══════════════════════════════════════════════════════════════════════════ */

const DAY = 86400000;

export default function SocialOverview({ project, onOpen }) {
    const posts = useProjectRows('social_posts', project.id);
    const campaigns = useProjectRows('social_campaigns', project.id);
    const launches = useProjectRows('social_launches', project.id);
    const metrics = useProjectRows('social_metrics', project.id);
    const fin = canSeeFinancials();

    // When the page opened: the windows below are counted from it.
    const [now] = useState(() => Date.now());
    const upcoming = useMemo(() => posts
        .filter((p) => p.scheduled_at && p.status !== 'published')
        .filter((p) => { const at = new Date(p.scheduled_at).getTime(); return at >= now - DAY / 2 && at <= now + 14 * DAY; })
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)), [posts, now]);
    const thisWeek = upcoming.filter((p) => new Date(p.scheduled_at).getTime() <= now + 7 * DAY).length;
    const waiting = posts.filter(awaitingApproval).sort((a, b) => String(a.scheduled_at || '9').localeCompare(String(b.scheduled_at || '9')));
    const live = campaigns.filter((c) => c.status === 'live');
    const today = new Date().toISOString().slice(0, 10);
    const ahead = launches.filter((l) => l.status === 'planning' || l.status === 'ready')
        .sort((a, b) => String(a.launch_date || '9999').localeCompare(String(b.launch_date || '9999')));
    const next = ahead[0];
    const { month, rows } = latestFigures(metrics);
    const followers = sumOf(rows.map((r) => r.now), 'followers');
    const before = rows.every((r) => r.before) ? sumOf(rows.map((r) => r.before), 'followers') : null;
    const empty = !posts.length && !campaigns.length && !launches.length && !metrics.length;

    const stats = [
        { label: 'Posts in the next 7 days', value: thisWeek, note: `${upcoming.length} in the next 14` },
        { label: 'Waiting for approval', value: waiting.length, note: `${waiting.filter((p) => p.status === 'client_review').length} with the client` },
        { label: 'Live campaigns', value: live.length, note: fin && live.length ? `${money(live.reduce((s, c) => s + (Number(c.spent) || 0), 0))} spent` : `${campaigns.length} in all` },
        {
            label: 'Followers', value: count(followers),
            note: followers == null ? 'Add figures under Analytics' : change(followers, before) ? `${change(followers, before)} on the month before` : 'Across all platforms',
        },
    ];

    if (empty) {
        return (
            <Panel>
                <Empty action={<Row gap={8} wrap style={{ justifyContent: 'center' }}>
                    <Btn primary onClick={() => onOpen('social-calendar')}>Plan the first post</Btn>
                    <Btn onClick={() => onOpen('social-campaigns')}>Plan a campaign</Btn>
                </Row>}>
                    Nothing here yet. Social keeps this project's content calendar, campaigns, launches and audience numbers in one place.
                </Empty>
            </Panel>
        );
    }

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <StatBand items={stats} />
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
                <Panel title="Coming up" note="Next 14 days" actions={<Btn size="sm" onClick={() => onOpen('social-calendar')}>Calendar</Btn>}>
                    {upcoming.length === 0 ? <Empty>Nothing scheduled in the next two weeks.</Empty> : (
                        <List items={upcoming.slice(0, 8)} render={(p) => (
                            <>
                                <span style={{ width: 96, flexShrink: 0 }}><Muted>{fmtDate(p.scheduled_at)} {timeOf(p.scheduled_at)}</Muted></span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                                <PlatformDots ids={p.platforms} />
                                <Status tone={postStatusOf(p.status).tone}>{postStatusOf(p.status).label}</Status>
                            </>
                        )} />
                    )}
                </Panel>
                <Panel title="Waiting for approval" actions={<Btn size="sm" onClick={() => onOpen('social-calendar')}>Review</Btn>}>
                    {waiting.length === 0 ? <Empty>Nothing is waiting for a yes.</Empty> : (
                        <List items={waiting.slice(0, 8)} render={(p) => (
                            <>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                                <Muted>{p.scheduled_at ? fmtDate(p.scheduled_at) : 'No date'}</Muted>
                                <Status tone="warn">{p.status === 'client_review' ? 'Client' : 'Team'}</Status>
                            </>
                        )} />
                    )}
                </Panel>
                <Panel title="Live campaigns" actions={<Btn size="sm" onClick={() => onOpen('social-campaigns')}>Campaigns</Btn>}>
                    {live.length === 0 ? <Empty>No campaign is live.</Empty> : (
                        <List items={live} render={(c) => (
                            <>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                    <Muted size={11}>{campaignKindOf(c.kind).label}{c.end_date ? ` · ends ${fmtDate(c.end_date)}` : ''}</Muted>
                                </span>
                                {fin && c.budget ? (
                                    <span style={{ width: 120, flexShrink: 0 }}>
                                        <Muted size={11}>{money(c.spent || 0)} of {money(c.budget)}</Muted>
                                        <Bar value={Number(c.spent) || 0} max={Number(c.budget)} height={4} />
                                    </span>
                                ) : <Muted>{count(c.leads)} leads</Muted>}
                            </>
                        )} />
                    )}
                </Panel>
                <Panel title="Launches ahead" actions={<Btn size="sm" onClick={() => onOpen('social-launches')}>Launches</Btn>}>
                    {!next ? <Empty>No launch is being planned.</Empty> : (
                        <List items={ahead.slice(0, 5)} render={(l) => {
                            const r = readiness(l);
                            const late = l.launch_date && l.launch_date < today;
                            return (
                                <>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                                        <Muted size={11}>{l.launch_date ? `${late ? 'Was due ' : ''}${fmtDate(l.launch_date)}` : 'No date'} · {launchStatusOf(l.status).label}</Muted>
                                    </span>
                                    {r != null && (
                                        <span style={{ width: 120, flexShrink: 0 }}>
                                            <Muted size={11}>{Math.round(r * 100)}% ready</Muted>
                                            <Bar value={r} max={1} height={4} />
                                        </span>
                                    )}
                                </>
                            );
                        }} />
                    )}
                </Panel>
            </div>
            {month && <Muted>Followers are from the {monthLabel(month)} figures.</Muted>}
        </div>
    );
}

/** Rows inside a panel, hairline between them. */
function List({ items, render }) {
    const t = useT();
    return (
        <div>
            {items.map((x, i) => (
                <div key={x.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', fontSize: 12.5, minWidth: 0,
                    borderTop: i ? '1px solid ' + t.line : 'none',
                }}>{render(x)}</div>
            ))}
        </div>
    );
}
