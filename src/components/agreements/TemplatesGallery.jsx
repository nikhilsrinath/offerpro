import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Scale, Handshake, FilePen, ArrowRight } from 'lucide-react';
import { Page, Grid } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { storageService } from '../../services/storageService';

// `count` picks this template's records out of the org's issued documents.
const TEMPLATES = [
  {
    to: '/documents/templates/nda', icon: ShieldCheck, title: 'Non-Disclosure Agreement', tag: 'NDA',
    desc: 'Confidentiality terms between a disclosing and a receiving party.',
    count: (r) => r.type === 'nda',
  },
  {
    to: '/documents/templates/mou', icon: Scale, title: 'Memorandum of Understanding', tag: 'MoU',
    desc: 'A framework for collaboration: purpose, scope and each side’s role.',
    count: (r) => r.type === 'mou',
  },
  {
    to: '/documents/templates/partnership', icon: Handshake, title: 'Partnership Agreement', tag: 'Partnership',
    desc: 'Contributions, profit sharing, management and term between two partners.',
    count: (r) => r.type === 'agreement' && r.data?.templateKind === 'partnership',
  },
  {
    to: '/documents/templates/custom', icon: FilePen, title: 'Custom Template', tag: 'Custom',
    desc: 'Your own title and clauses on the letterhead. Choose which parties and witnesses appear.',
    count: (r) => r.type === 'agreement' && r.data?.templateKind === 'custom',
  },
];

export default function TemplatesGallery() {
  const t = useT();
  const { activeOrg } = useOrg();
  const [records, setRecords] = useState(null);

  useEffect(() => {
    if (!activeOrg?.id) return undefined;
    let cancelled = false;
    storageService.getAll(activeOrg.id).then((rows) => { if (!cancelled) setRecords(rows); });
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  return (
    <Page>
      {/* Cards in the dashboards' own style: the blue wash, a tinted icon, and a lift on hover. */}
      <style>{`
        .tpl-card { transition: border-color .18s, box-shadow .18s, transform .22s cubic-bezier(.16,1,.3,1); }
        .tpl-card:hover { border-color: ${t.lineStrong} !important; transform: translateY(-3px); box-shadow: ${t.highlight}, 0 16px 32px -18px ${t.isDark ? 'rgba(0,0,0,.95)' : 'rgba(15,17,21,.38)'} !important; }
        .tpl-card:hover .tpl-start { filter: brightness(1.08); }
        .tpl-card:hover .tpl-start svg { transform: translateX(2px); }
        .tpl-start svg { transition: transform .15s; }
        @media (prefers-reduced-motion: reduce) { .tpl-card, .tpl-card:hover { transform: none; transition: none; } }
      `}</style>
      <Grid min={270} gap={14}>
        {TEMPLATES.map(({ to, icon: Icon, title, tag, desc, count }) => {
          const issued = records ? records.filter(count).length : null;
          return (
            <Link key={to} to={to} className="tpl-card" aria-label={`${title}: start a new document`} style={{
              display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 18px 14px',
              border: '1px solid ' + t.line, borderRadius: 18, background: t.card, boxShadow: t.highlight,
              backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${t.accentSoft}, transparent 60%)`,
              color: t.text, textDecoration: 'none', minHeight: 200,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden="true" style={{
                  display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 12,
                  background: t.accentSoft, color: t.accent, flexShrink: 0,
                }}>
                  <Icon size={19} strokeWidth={1.9} />
                </span>
                <span style={{ flex: 1 }} />
                <span style={{
                  display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 99,
                  fontSize: 12, fontWeight: 500, color: t.dim, background: t.panelAlt, border: '1px solid ' + t.line,
                }}>{tag}</span>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em', color: t.text, lineHeight: 1.3 }}>{title}</h2>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: t.dim, lineHeight: 1.55 }}>{desc}</p>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 12, borderTop: '1px solid ' + t.line }}>
                <span style={{ fontSize: 12.5, color: t.faint }}>{issued === null ? ' ' : `${issued} issued`}</span>
                <span style={{ flex: 1 }} />
                <span className="tpl-start" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', borderRadius: 9,
                  fontSize: 13, fontWeight: 500, background: t.accentBtn, color: t.onAccent,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25), 0 6px 16px -8px ' + t.accent,
                }}>
                  Start <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
                </span>
              </div>
            </Link>
          );
        })}
      </Grid>
    </Page>
  );
}
