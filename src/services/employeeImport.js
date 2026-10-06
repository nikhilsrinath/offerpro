/* Checks an uploaded sheet of employees against the registry before anything
   is saved.

   The registry is everyone on the books — current employees and ex-employees,
   since an Employee ID is never reused. For each row:

     · the same email, or the same Employee ID, as someone already there (or as
       an earlier row of the same sheet) stops the row — it is the same person
       or a clash, so it is fixed or deleted;
     · the same name alone is only a warning: two people can share a name, so
       the user may Ignore it, and the row then imports.

   The result is one { errors, warning } per row, in row order. */

const norm = (v) => String(v ?? '').trim().toLowerCase();
const fullName = (row) => norm(`${row.first_name || ''} ${row.last_name || ''}`.replace(/\s+/g, ' '));
const nameOfEmployee = (e) => norm(e.studentName || e.name || e.full_name);

export function findDuplicates(rows, registry, ignored = new Set()) {
    const byEmail = new Map();
    const byCode = new Map();
    const byName = new Map();
    for (const e of registry) {
        const tag = e.exited_at ? ' (an ex-employee)' : '';
        if (norm(e.email)) byEmail.set(norm(e.email), `${e.studentName || e.name || 'someone'}${tag}`);
        if (norm(e.employee_code)) byCode.set(norm(e.employee_code), `${e.studentName || e.name || 'someone'}${tag}`);
        if (nameOfEmployee(e)) byName.set(nameOfEmployee(e), tag ? 'an ex-employee' : 'the registry');
    }
    const seenEmail = new Set();
    const seenCode = new Set();
    const seenName = new Set();

    return rows.map((row) => {
        const errors = [];
        let warning = '';
        const email = norm(row.email);
        const code = norm(row.employee_id);
        const name = fullName(row);

        if (email) {
            if (byEmail.has(email)) errors.push(`email is already in the registry for ${byEmail.get(email)}`);
            else if (seenEmail.has(email)) errors.push('email appears again above in this file');
        }
        if (code) {
            if (byCode.has(code)) errors.push(`employee id is already used by ${byCode.get(code)}`);
            else if (seenCode.has(code)) errors.push('employee id appears again above in this file');
        }
        if (name && !errors.length && !ignored.has(row._key)) {
            if (byName.has(name)) warning = `same name as someone in ${byName.get(name)}`;
            else if (seenName.has(name)) warning = 'same name as a row above';
        }

        if (email) seenEmail.add(email);
        if (code) seenCode.add(code);
        if (name) seenName.add(name);
        return { errors, warning };
    });
}
