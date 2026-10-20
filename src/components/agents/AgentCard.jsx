import { ArrowUpRight } from 'lucide-react';
import { autoLabel } from './automation';

/*
 * One card on the Agents grid. The card opens the agent; the switch in its
 * corner turns its automatic run on or off. They are siblings (a full-card
 * button underneath, the switch above it), never a button inside a button.
 *
 * Owners and admins see the switch; everyone else sees the state as words.
 */

export function AgentSwitch({ id, name, auto }) {
    const state = auto?.agents?.[id];
    const label = autoLabel(state);
    if (!auto?.canManage || state?.coming_soon) {
        return <span className={`ag-state${state?.daily ? '' : ' is-off'}`}><i aria-hidden="true" />{label}</span>;
    }
    const on = !!state?.daily;
    const blocked = auto.unavailable || auto.loading;
    const why = auto.unavailable ? 'Needs database migration 0089' : on ? `${label}. Turn off to run only when opened.` : 'Run every morning and alert owners and admins';
    return (
        <button type="button" role="switch" aria-checked={on} aria-label={`Run ${name} automatically`}
            className={`ag-switch${on ? ' is-on' : ''}`} disabled={blocked} title={why}
            onClick={() => auto.set(id, !on)}>
            <span className="ag-switch-text">{on ? label : 'Off'}</span>
            <span className="ag-switch-track" aria-hidden="true"><span className="ag-switch-knob" /></span>
        </button>
    );
}

export default function AgentCard({ agent, auto, onOpen, children }) {
    const Icon = agent.icon;
    return (
        <div className="ag-card">
            <button type="button" className="ag-card-hit" onClick={onOpen} aria-label={`Open ${agent.name}`} />
            <span className="ag-card-top">
                <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                <AgentSwitch id={agent.id} name={agent.name} auto={auto} />
            </span>
            <span className="ag-name">{agent.name}</span>
            <span className="ag-desc">{agent.blurb}</span>
            <span className="ag-foot">
                {children}
                <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" className="ag-go" />
            </span>
        </div>
    );
}
