import { useMemo } from 'react';
import { useSection } from '../financial/financeHooks';
import { pickerOrder, projectLabel } from '../../services/projectAnalytics';
import { GENERAL, INTERNAL } from '../../services/belongsTo';

/* What a vendor or product belongs to — the dropdown on the Vendor Directory
   and Products Directory forms, and the filter beside their lists. Open
   projects are offered; a closed one stays listed while it is the value, so
   editing an old row never silently drops its project. */

function useProjectOptions(value) {
    const projects = useSection('projects');
    return useMemo(() => {
        const open = pickerOrder(projects);
        const extra = value && value !== GENERAL && value !== INTERNAL && !open.some((p) => p.id === value)
            ? projects.filter((p) => p.id === value) : [];
        return [...open, ...extra];
    }, [projects, value]);
}

/** The form dropdown. */
export default function BelongsToSelect({ id, value, onChange }) {
    const options = useProjectOptions(value);
    return (
        <select id={id} value={value || GENERAL} onChange={(e) => onChange(e.target.value)}>
            <option value={GENERAL}>Others</option>
            <option value={INTERNAL}>Internal</option>
            {options.length > 0 && (
                <optgroup label="Project">
                    {options.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
                </optgroup>
            )}
        </select>
    );
}

/** The list filter: all, Others, Internal, or one project. */
export function BelongsToFilter({ value, onChange, className }) {
    const options = useProjectOptions(value);
    return (
        <select aria-label="Filter by what it belongs to" className={className} value={value}
            onChange={(e) => onChange(e.target.value)}>
            <option value="">All</option>
            <option value={GENERAL}>Others</option>
            <option value={INTERNAL}>Internal</option>
            {options.length > 0 && (
                <optgroup label="Project">
                    {options.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
                </optgroup>
            )}
        </select>
    );
}
