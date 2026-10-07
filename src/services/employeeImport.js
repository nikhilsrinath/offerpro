/* Checks an uploaded sheet of employees against the registry before anything
   is saved.

   The registry is everyone on the books, current employees and ex-employees,
   since an Employee ID is never reused. For each row:

     · the same email, or the same Employee ID, as a current employee (or as
       an earlier row of the same sheet) stops the row. It is the same person
       or a clash, so it is fixed or deleted;
     · the same email or Employee ID as an ex-employee is that person joining
       again: the row is a rejoin, and importing it brings their own record
       back (same Employee ID) instead of adding a second one. Both must point
       at the same ex-employee, and an Employee ID, if the sheet gives one,
       must be the one they left with;
     · the same name alone is only a warning: two people can share a name, so
       the user may Ignore it, and the row then imports.

   The result is one { errors, warning, rejoin } per row, in row order, where
   rejoin is the ex-employee the row brings back (or null). */

const norm = (v) => String(v ?? '').trim().toLowerCase();
const fullName = (row) => norm(`${row.first_name || ''} ${row.last_name || ''}`.replace(/\s+/g, ' '));
const nameOfEmployee = (e) => norm(e.studentName || e.name || e.full_name);
const who = (e) => `${e.studentName || e.name || 'someone'}${e.exited_at ? ' (an ex-employee)' : ''}`;

export function findDuplicates(rows, registry, ignored = new Set()) {
    const byEmail = new Map();
    const byCode = new Map();
    const byName = new Map();
    for (const e of registry) {
        if (norm(e.email)) byEmail.set(norm(e.email), e);
        if (norm(e.employee_code)) byCode.set(norm(e.employee_code), e);
        if (nameOfEmployee(e)) byName.set(nameOfEmployee(e), e.exited_at ? 'an ex-employee' : 'the registry');
    }
    const seenEmail = new Set();
    const seenCode = new Set();
    const seenName = new Set();
    const seenRejoin = new Set();

    return rows.map((row) => {
        const errors = [];
        let warning = '';
        let rejoin = null;
        const email = norm(row.email);
        const code = norm(row.employee_id);
        const name = fullName(row);
        const emailHit = email ? byEmail.get(email) : null;
        const codeHit = code ? byCode.get(code) : null;

        if (email) {
            if (emailHit && !emailHit.exited_at) errors.push(`email is already in the registry for ${who(emailHit)}`);
            else if (seenEmail.has(email)) errors.push('email appears again above in this file');
        }
        if (code) {
            if (codeHit && !codeHit.exited_at) errors.push(`employee id is already used by ${who(codeHit)}`);
            else if (seenCode.has(code)) errors.push('employee id appears again above in this file');
        }

        const back = [emailHit, codeHit].filter((e) => e?.exited_at);
        if (!errors.length && back.length) {
            const [person] = back;
            if (back.length === 2 && back[0].id !== back[1].id) {
                errors.push(`email belongs to ${who(back[0])} but employee id belongs to ${who(back[1])}`);
            } else if (code && !codeHit && person.employee_code) {
                errors.push(`${person.studentName || person.name || 'they'} left with employee id ${person.employee_code}. Use that, or leave it blank, to bring them back`);
            } else if (seenRejoin.has(person.id)) {
                errors.push(`${who(person)} is already brought back by a row above`);
            } else {
                rejoin = person;
                seenRejoin.add(person.id);
            }
        }

        if (name && !errors.length && !rejoin && !ignored.has(row._key)) {
            if (byName.has(name)) warning = `same name as someone in ${byName.get(name)}`;
            else if (seenName.has(name)) warning = 'same name as a row above';
        }

        if (email) seenEmail.add(email);
        if (code) seenCode.add(code);
        if (name) seenName.add(name);
        return { errors, warning, rejoin };
    });
}
