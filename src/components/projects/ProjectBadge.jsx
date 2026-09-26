import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../ui/edgeUtils';

/** Code + name, linking to the project. */
export default function ProjectBadge({ project, link = true }) {
    const t = useT();
    if (!project) return <span style={{ color: t.ghost }}>General</span>;
    const body = (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, color: t.faint, letterSpacing: '0.04em' }}>{project.code}</span>
            <span style={{ color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
        </span>
    );
    if (!link) return body;
    return (
        <Link to={`/projects/${project.id}`} style={{ textDecoration: 'none', minWidth: 0 }}
            onClick={(e) => e.stopPropagation()}>
            {body}
        </Link>
    );
}

