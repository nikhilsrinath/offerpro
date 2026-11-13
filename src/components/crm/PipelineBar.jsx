import { Check, X } from 'lucide-react';
import { useT } from '../ui/edgeUtils';
import { STAGES, chevronStates, stateOf } from './dealModel';

/* The pipeline as a row of chevrons, one per stage.
     done     teal       a stage the deal has passed (every stage, once won)
     current  navy       where an open deal is now
     lost     red        where a lost or abandoned deal stopped
     todo     light grey ahead
   `size="sm"` is the list's: no words, 12px high, purely a picture with a
   text alternative. `size="lg"` is the record's: each chevron a button that
   moves the deal there (when `onPick` is given and the deal is open). */
export default function PipelineBar({ deal, size = 'sm', onPick }) {
    const t = useT();
    const states = chevronStates(deal);
    const lg = size === 'lg';
    const h = lg ? 34 : 12;
    const tip = lg ? 12 : 6;
    const fill = {
        done: [t.teal, t.onTeal],
        current: [t.accentBtn, t.onAccent],
        lost: [t.down, '#fff'],
        todo: [t.isDark ? t.raised : '#d3d9e1', t.dim],
    };
    const current = STAGES.find((s, i) => states[i] === 'current' || states[i] === 'lost');
    const summary = deal.state === 'open'
        ? `Stage ${STAGES.findIndex((s) => s.id === deal.stage) + 1} of ${STAGES.length}: ${current?.label || ''}`
        : `${stateOf(deal.state).label}${current ? ` at ${current.label}` : ''}`;
    const canPick = !!onPick && deal.state === 'open';

    return (
        <div role={lg ? 'group' : 'img'} aria-label={lg ? 'Pipeline stages' : summary} title={lg ? undefined : summary}
            style={{ display: 'flex', gap: lg ? 3 : 2, width: '100%', minWidth: lg ? 0 : 120 }}>
            {STAGES.map((s, i) => {
                const st = states[i];
                const [bg, fg] = fill[st];
                const first = i === 0;
                const last = i === STAGES.length - 1;
                const clip = `polygon(0 0, calc(100% - ${last ? 0 : tip}px) 0, 100% 50%, calc(100% - ${last ? 0 : tip}px) 100%, 0 100%, ${first ? 0 : tip}px 50%)`;
                const style = {
                    flex: 1, minWidth: 0, height: h, background: bg, color: fg, border: 'none',
                    clipPath: clip, WebkitClipPath: clip,
                    borderRadius: first ? `${lg ? 7 : 3}px 0 0 ${lg ? 7 : 3}px` : last ? `0 ${lg ? 7 : 3}px ${lg ? 7 : 3}px 0` : 0,
                    marginLeft: first ? 0 : -tip + (lg ? 4 : 3),
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    padding: lg ? `0 ${tip + 4}px` : 0,
                    fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                    fontFamily: 'inherit',
                };
                if (!lg) return <span key={s.id} aria-hidden="true" style={style} />;
                const label = (
                    <>
                        {st === 'done' && <Check size={14} aria-hidden="true" style={{ flexShrink: 0 }} />}
                        {st === 'lost' && <X size={14} aria-hidden="true" style={{ flexShrink: 0 }} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    </>
                );
                return canPick ? (
                    <button key={s.id} type="button" className="crm-chevron" onClick={() => onPick(s.id)}
                        aria-pressed={st === 'current'} aria-label={`Move to ${s.label}${st === 'current' ? ' (current stage)' : ''}`}
                        style={{ ...style, cursor: st === 'current' ? 'default' : 'pointer' }}>
                        {label}
                    </button>
                ) : (
                    <span key={s.id} style={style} aria-label={`${s.label}: ${st === 'todo' ? 'not reached' : st}`}>{label}</span>
                );
            })}
        </div>
    );
}
