import React from 'react';
import { MONO } from '../../theme/edge';

/* ══════════════════════════════════════════════════════════════════════════
   Markdown — the small subset the assistant actually emits.

   The model answers in markdown (bold labels, bullet lists, the odd heading)
   and the bubbles used to print it verbatim, so "**Total Revenue:**" reached
   the user with its asterisks still attached. Rather than add a parser
   dependency for four constructs, this renders them directly: headings,
   bullet and numbered lists, bold, italic and inline code. Anything else
   falls through as plain text, which is the right failure for a chat bubble.

   It runs on every streamed token, so it stays linear in the text length —
   no backtracking regex, no re-parsing of earlier lines.
   ══════════════════════════════════════════════════════════════════════════ */

// **bold** · __bold__ · *italic* · _italic_ · `code`
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

function inline(text, t, keyBase) {
    return text.split(INLINE).map((part, i) => {
        const key = keyBase + ':' + i;
        if (!part) return null;
        if ((part.startsWith('**') && part.endsWith('**') && part.length > 4) ||
            (part.startsWith('__') && part.endsWith('__') && part.length > 4)) {
            return <strong key={key} style={{ fontWeight: 600, color: t.text }}>{part.slice(2, -2)}</strong>;
        }
        if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
            (part.startsWith('_') && part.endsWith('_') && part.length > 2)) {
            return <em key={key}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            return (
                <code key={key} style={{
                    fontFamily: MONO, fontSize: '0.92em', padding: '1px 4px',
                    borderRadius: 4, background: t.raised, color: t.text,
                }}>{part.slice(1, -1)}</code>
            );
        }
        return <React.Fragment key={key}>{part}</React.Fragment>;
    });
}

const BULLET = /^\s*([*\-•])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,4})\s+(.*)$/;

export default function Markdown({ text, t }) {
    const lines = String(text || '').split('\n');
    const out = [];
    let list = null;          // { ordered, items: [] }

    const flush = () => {
        if (!list) return;
        const Tag = list.ordered ? 'ol' : 'ul';
        out.push(
            <Tag key={'l' + out.length} style={{ margin: '4px 0', paddingLeft: 18, display: 'grid', gap: 3 }}>
                {list.items.map((item, i) => <li key={i}>{inline(item, t, 'li' + i)}</li>)}
            </Tag>
        );
        list = null;
    };

    lines.forEach((line, idx) => {
        const heading = line.match(HEADING);
        if (heading) {
            flush();
            out.push(
                <div key={'h' + idx} style={{
                    fontWeight: 600, color: t.text, marginTop: out.length ? 8 : 0,
                    fontSize: heading[1].length <= 2 ? '1.08em' : '1em',
                }}>{inline(heading[2], t, 'h' + idx)}</div>
            );
            return;
        }

        const bullet = line.match(BULLET);
        const numbered = !bullet && line.match(NUMBERED);
        if (bullet || numbered) {
            const ordered = Boolean(numbered);
            if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
            list.items.push((bullet || numbered)[2]);
            return;
        }

        flush();
        // Blank lines only separate blocks, and the grid gap already spaces them.
        if (!line.trim()) return;
        out.push(<p key={'p' + idx} style={{ margin: 0 }}>{inline(line, t, 'p' + idx)}</p>);
    });
    flush();

    return (
        <div style={{ display: 'grid', gap: 6 }}>{out}</div>
    );
}
