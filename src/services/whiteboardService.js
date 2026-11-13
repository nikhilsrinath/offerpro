// whiteboardService.js: one Miro-style board per project (0111,
// project_whiteboards). The board is one JSON document; `version` goes up on
// every save (the database does it), and a save only lands on the version it
// was made from, so two people saving at once cannot overwrite each other
// unnoticed: the second gets a conflict and chooses what to keep.

import { supabase } from '../lib/supabase';

const COLS = 'id, project_id, data, version, updated_by, updated_at';

export class BoardConflict extends Error {
    constructor(latest) {
        super('Someone else saved this board while you were drawing.');
        this.name = 'BoardConflict';
        this.latest = latest;
    }
}

/** True when the database has not had 0111 applied. */
export const boardTableMissing = (e) => /project_whiteboards/.test(e?.message || '')
    && /relation|does not exist|schema cache|Could not find/.test(e?.message || '');

export const whiteboardService = {
    /** The project's board, or null when it has never been saved. */
    async load(projectId) {
        const { data, error } = await supabase.from('project_whiteboards').select(COLS)
            .eq('project_id', projectId).maybeSingle();
        if (error) throw error;
        return data || null;
    },

    /** Just the version and who saved it last, to see whether someone else has saved since. */
    async head(projectId) {
        const { data, error } = await supabase.from('project_whiteboards').select('version, updated_by, updated_at')
            .eq('project_id', projectId).maybeSingle();
        if (error) throw error;
        return data || null;
    },

    /**
     * Saves `data` as the next version after `version` (null: the board's
     * first save). With `force` it overwrites whatever is there.
     */
    async save(orgId, projectId, data, version, { force = false } = {}) {
        if (version == null) {
            const { data: row, error } = await supabase.from('project_whiteboards')
                .insert({ org_id: orgId, project_id: projectId, data }).select(COLS).maybeSingle();
            if (!error && row) return row;
            // Someone saved the first version a moment before us.
            if (error?.code === '23505') throw new BoardConflict(await whiteboardService.load(projectId));
            if (error) throw error;
            throw new Error('You do not have permission to draw on this board.');
        }
        let q = supabase.from('project_whiteboards').update({ data }).eq('project_id', projectId);
        if (!force) q = q.eq('version', version);
        const { data: row, error } = await q.select(COLS).maybeSingle();
        if (error) throw error;
        if (row) return row;
        const latest = await whiteboardService.load(projectId);
        if (latest && latest.version !== version) throw new BoardConflict(latest);
        throw new Error('You do not have permission to draw on this board.');
    },
};
