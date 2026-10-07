/* ══════════════════════════════════════════════════════════════════════════
   Important tasks (0077): the ones an owner or admin has marked, while
   they are still open, are what the project dashboards list under
   "Needs attention".

   A task is open until it is done. A summary node (one with sub-tasks) is
   done when every work item under it is done, whatever its own status says,
   because the WBS rolls a summary up from its work items.

   Pure: no store, no network, so the rules are tested on their own.
   ══════════════════════════════════════════════════════════════════════════ */

const day = (v) => (v ? String(v).slice(0, 10) : '');

/** Whether the workspace has the column yet (rows carry `important` once 0077 is applied). */
export function importantSupported(tasks) {
    return tasks.length === 0 || tasks.some((x) => x.important !== undefined);
}

/** Whether `task` is finished, rolling a summary node up from its work items. */
function doneFn(tasks) {
    const kids = new Map();
    tasks.forEach((x) => {
        if (!x.parentId) return;
        if (!kids.has(x.parentId)) kids.set(x.parentId, []);
        kids.get(x.parentId).push(x);
    });
    const memo = new Map();
    const done = (x, seen = new Set()) => {
        if (memo.has(x.id)) return memo.get(x.id);
        const under = kids.get(x.id);
        let v;
        if (!under || !under.length || seen.has(x.id)) v = x.status === 'done';
        else {
            seen.add(x.id);
            v = under.every((k) => done(k, seen));
        }
        memo.set(x.id, v);
        return v;
    };
    return done;
}

/**
 * The open important tasks among `tasks`, most urgent first: late ones
 * (oldest deadline first), then the rest by deadline, then those with no
 * deadline, most recently marked first.
 * Each comes back as { task, late, due } · `due` the deadline as YYYY-MM-DD.
 * `projectIds`, when given, keeps only tasks of those projects.
 */
export function needsAttention(tasks, today, projectIds = null) {
    const done = doneFn(tasks);
    return tasks
        .filter((x) => x.important && x.projectId && (!projectIds || projectIds.has(x.projectId)) && !done(x))
        .map((x) => {
            const due = day(x.deadline);
            return { task: x, due, late: !!due && due < today };
        })
        .sort((a, b) => {
            if (a.late !== b.late) return a.late ? -1 : 1;
            if (!!a.due !== !!b.due) return a.due ? -1 : 1;
            if (a.due !== b.due) return a.due.localeCompare(b.due);
            const at = String(b.task.importantAt || '').localeCompare(String(a.task.importantAt || ''));
            return at || String(a.task.title || '').localeCompare(String(b.task.title || ''));
        });
}
