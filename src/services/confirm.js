/* One confirmation dialog for the whole app.

   Anything destructive asks through here instead of window.confirm or an
   inline "Sure?" swap, so every delete looks and behaves the same: a small
   centred dialog over a dimmed, blurred page, Cancel beside a red action.

     if (!(await confirmDialog({ title: 'Delete task', message: 'This cannot be undone.' }))) return;

   Resolves true on confirm, false on cancel, Escape or a click outside.
   Requests queue, so two asks in a row show one after the other. The dialog
   itself is <ConfirmHost>, mounted once at the root of the app. */

let queue = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

/**
 * @param {object} o
 * @param {string} o.title            e.g. 'Delete invoice'
 * @param {string} [o.message]        what will happen, in a sentence
 * @param {string} [o.confirmLabel]   defaults to 'Delete'
 * @param {string} [o.cancelLabel]    defaults to 'Cancel'
 * @param {'danger'|'default'} [o.tone]  red action, or the neutral primary
 * @returns {Promise<boolean>}
 */
export function confirmDialog(o) {
    return new Promise((resolve) => {
        queue = [...queue, {
            id: Math.random().toString(36).slice(2),
            title: o.title || 'Are you sure?',
            message: o.message || '',
            confirmLabel: o.confirmLabel || 'Delete',
            cancelLabel: o.cancelLabel || 'Cancel',
            tone: o.tone || 'danger',
            resolve,
        }];
        emit();
    });
}

/** Shorthand for the common case: "Delete <thing>" / "This cannot be undone." */
export const confirmDelete = (what, message) => confirmDialog({
    title: `Delete ${what}`,
    message: message || `Are you sure you want to delete this ${what}? This cannot be undone.`,
});

export function settleConfirm(id, ok) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    queue = queue.filter((q) => q.id !== id);
    emit();
    item.resolve(ok);
}

export const subscribeConfirm = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const currentConfirm = () => queue[0] || null;
