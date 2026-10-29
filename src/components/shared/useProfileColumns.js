import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/* Whether `clients` / `vendors` have the 0074 profile columns (logo, website,
   contact persons…). The Add Client and Add Vendor panels show those fields
   only when they do, so a save never sends a column the database lacks.
   Asked once per table per session. */

const known = {};

export function useProfileColumns(table) {
    const [has, setHas] = useState(known[table] ?? null);
    useEffect(() => {
        // Already asked: the initial state has the answer.
        if (known[table] !== undefined) return undefined;
        let cancelled = false;
        supabase.from(table).select('contacts').limit(1).then(({ error }) => {
            // Only a missing column means "no"; any other refusal is not about 0074.
            const missing = !!error && /column|schema cache|does not exist/i.test(error.message || '');
            known[table] = !missing;
            if (!cancelled) setHas(!missing);
        });
        return () => { cancelled = true; };
    }, [table]);
    return has;
}
