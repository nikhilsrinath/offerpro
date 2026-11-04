import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/* Whether `clients` / `vendors` have a column a later migration added: by
   default `contacts`, the 0074 profile columns (logo, website, contact
   persons…); `company_profile` for 0106's company details. The Add Client and
   Add Vendor panels show those fields only when they do, so a save never
   sends a column the database lacks. Asked once per table and column per
   session. */

const known = {};

export function useProfileColumns(table, column = 'contacts') {
    const key = `${table}.${column}`;
    const [has, setHas] = useState(known[key] ?? null);
    useEffect(() => {
        // Already asked: the initial state has the answer.
        if (known[key] !== undefined) return undefined;
        let cancelled = false;
        supabase.from(table).select(column).limit(1).then(({ error }) => {
            // Only a missing column means "no"; any other refusal is not about the migration.
            const missing = !!error && /column|schema cache|does not exist/i.test(error.message || '');
            known[key] = !missing;
            if (!cancelled) setHas(!missing);
        });
        return () => { cancelled = true; };
    }, [table, column, key]);
    return has;
}
