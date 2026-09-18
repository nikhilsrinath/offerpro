// AnnouncementsTab — the board, newest first with pinned notices on top.
// Opening a notice (or "mark all read") is what clears the unread dot.
import { useState } from 'react';
import { Pin } from 'lucide-react';
import { Btn, Seg, Empty } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { fmtLongDay } from './portalUtils';

export default function AnnouncementsTab({ notices, readIds, onOpen }) {
  const t = useT();
  const [filter, setFilter] = useState('all');
  const unread = notices.filter((a) => !readIds.has(a.id));
  const shown = filter === 'unread' ? unread : filter === 'pinned' ? notices.filter((a) => a.is_pinned) : notices;

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Seg size="sm" value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'All', count: notices.length },
          { id: 'unread', label: 'Unread', count: unread.length },
          { id: 'pinned', label: 'Pinned', count: notices.filter((a) => a.is_pinned).length },
        ]} />
        <div style={{ flex: 1 }} />
        {unread.length > 0 && <Btn size="sm" onClick={() => unread.forEach((a) => onOpen(a.id))}>Mark all read</Btn>}
      </div>

      {shown.length ? shown.map((a) => {
        const isUnread = !readIds.has(a.id);
        return (
          <article
            key={a.id}
            onMouseEnter={() => onOpen(a.id)} onFocus={() => onOpen(a.id)} tabIndex={0}
            style={{
              border: '1px solid ' + (a.is_pinned ? t.lineStrong : t.line), borderRadius: 12,
              background: t.panel, padding: '15px 17px', position: 'relative',
              boxShadow: isUnread ? `inset 3px 0 0 ${t.text}` : 'none',
            }}
          >
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {a.is_pinned && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, letterSpacing: '0.08em', color: t.dim, border: '1px solid ' + t.line, borderRadius: 5, padding: '2px 6px' }}>
                  <Pin size={10} /> PINNED
                </span>
              )}
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: t.text, letterSpacing: '-0.01em' }}>{a.title}</h3>
              <div style={{ flex: 1 }} />
              {isUnread && <span style={{ fontSize: 9, letterSpacing: '0.08em', color: t.selText, background: t.selBg, borderRadius: 4, padding: '2px 6px' }}>NEW</span>}
              <span style={{ fontSize: 10, color: t.faint }}>{fmtLongDay(a.published_at)}</span>
            </header>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: t.dim, whiteSpace: 'pre-wrap' }}>{a.body}</p>
          </article>
        );
      }) : <Empty>{filter === 'all' ? 'Nothing announced yet.' : `No ${filter} announcements.`}</Empty>}
    </div>
  );
}
