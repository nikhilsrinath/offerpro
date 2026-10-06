/* Dates as they arrive in an uploaded sheet, and as the screen shows them.

   A spreadsheet hands a date over as an Excel serial (46113.0001574074), as
   text ("01-Apr-2026", "01/04/2026") or as ISO. Everything is kept as ISO
   (yyyy-mm-dd), which is what a date input and the database both use, and
   shown as dd/mm/yyyy. */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n) => String(n).padStart(2, '0');

const valid = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const iso = (y, m, d) => (valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null);

/** yyyy-mm-dd for anything that reads as a date, '' for blank, null for the unreadable. */
export function toIsoDate(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
    const text = String(value).trim();
    if (!text) return '';
    // Excel serial: days since 1899-12-30, the time of day after the point.
    if (/^\d+(\.\d+)?$/.test(text) && Number(text) > 59 && Number(text) < 2958466) {
        const d = new Date(Math.round((Number(text) - 25569) * 86400000));
        return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(text);
    if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    m = /^(\d{1,2})[/\-. ]([A-Za-z]{3,9})[/\-. ,]*(\d{2}|\d{4})$/.exec(text);
    if (m) {
        const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
        if (mon) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], mon, +m[1]);
    }
    return null;
}

/** dd/mm/yyyy for an ISO date; anything else comes back as it is. */
export function fmtDmy(isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(isoDate || '');
}
