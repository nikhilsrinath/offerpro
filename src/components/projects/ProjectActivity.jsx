import React, { useEffect, useState } from 'react';
import { Panel, Empty, Loading, Muted } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { activity } from '../../services/projectService';
import { describeActivity } from './activityText';

/* The project's history, newest first, from audit_log. Allocation history is
   hidden by the database from anyone without Project financials (0052). */

export default function ProjectActivity({ project }) {
    const t = useT();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        activity(project.id)
            .then((r) => { if (!cancelled) setRows(r.filter((a) => describeActivity(a))); })
            .catch((e) => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
    }, [project.id, project.updated_at]);

    if (error) return <Panel><Empty>{error}</Empty></Panel>;
    if (!rows) return <Loading />;

    return (
        <Panel title="Activity" note="Changes to the project, its team, milestones, documents and money links">
            {rows.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {rows.map((a) => (
                        <li key={a.id} style={{
                            display: 'flex', gap: 14, padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft,
                        }}>
                            <span style={{ width: 150, flexShrink: 0 }}>
                                <Muted>{new Date(a.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</Muted>
                            </span>
                            <span style={{ fontSize: 11.5, color: t.text, lineHeight: 1.5 }}>{describeActivity(a)}</span>
                        </li>
                    ))}
                </ol>
            )}
        </Panel>
    );
}
