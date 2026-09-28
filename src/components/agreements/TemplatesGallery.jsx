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
    to: '/templates/nda', icon: ShieldCheck, title: 'Non-Disclosure Agreement', tag: 'NDA',
    desc: 'Confidentiality terms between a disclosing and a receiving party.',
    count: (r) => r.type === 'nda',
  },
  {
    to: '/templates/mou', icon: Scale, title: 'Memorandum of Understanding', tag: 'MoU',
    desc: 'A framework for collaboration: purpose, scope and each side’s role.',
    count: (r) => r.type === 'mou',
  },
  {
    to: '/templates/partnership', icon: Handshake, title: 'Partnership Agreement', tag: 'Partnership',
    desc: 'Contributions, profit sharing, management and term between two partners.',
    count: (r) => r.type === 'agreement' && r.data?.templateKind === 'partnership',
  },
  {
    to: '/templates/custom', icon: FilePen, title: 'Custom Template', tag: 'Custom',
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
      <Grid min={250} gap={12}>
        {TEMPLATES.map(({ to, icon: Icon, title, tag, desc, count }) => {
          const issued = records ? records.filter(count).length : null;
          return (
            <Link key={to} to={to} className="edge-tr" aria-label={`${title}: start a new document`} style={{
              display: 'flex', flexDirection: 'column', gap: 12, padding: 16,
              border: '1px solid ' + t.line, borderRadius: 10, background: t.panel,
              color: t.text, textDecoration: 'none', minHeight: 170,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden="true" style={{
                  display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8,
                  border: '1px solid ' + t.line, background: t.panelAlt, color: t.dim, flexShrink: 0,
                }}>
                  <Icon size={17} strokeWidth={1.7} />
                </span>
                <span style={{ fontSize: 10.5, letterSpacing: '0.1em', color: t.faint }}>{tag.toUpperCase()}</span>
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: t.text }}>{title}</div>
                <div style={{ fontSize: 12, color: t.dim, marginTop: 5, lineHeight: 1.5 }}>{desc}</div>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 11.5, color: t.faint }}>
                <span>{issued === null ? ' ' : `${issued} issued`}</span>
                <span style={{ flex: 1 }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: t.text }}>
                  Start <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
                </span>
              </div>
            </Link>
          );
        })}
      </Grid>
    </Page>
  );
}
