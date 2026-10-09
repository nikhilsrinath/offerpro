/* Title Case for the app's headings and labels: "Project health" reads
   "Project Health". Short joining words stay lower case ("Cost of Sales"),
   and words someone already cased on purpose (GST, EdgeAI, iPhone) are left
   alone. Anything that reads as a sentence, ending in a full stop or running
   long, is returned untouched, so notes and hints keep their sentence case. */

const MINOR = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so',
    'as', 'at', 'by', 'in', 'of', 'on', 'to', 'per', 'via', 'vs', 'vs.',
    'from', 'with', 'into', 'onto', 'than', 'is',
]);

export function titleCase(text) {
    if (typeof text !== 'string') return text;
    const s = text.trim();
    // Abbreviations ("incl.", "no.") are not the end of a sentence.
    const plain = s.replace(/\b(incl|excl|approx|no|vs|etc|op|qty|e\.g|i\.e)\./gi, '$1');
    if (!s || s.length > 60 || /[.!]$/.test(plain) || /[.!?] /.test(plain)) return text;
    const words = s.split(/\s+/).length;
    let i = 0;
    let afterBreak = false;
    return text.replace(/\S+/g, (word) => {
        i += 1;
        // The first and last words are always capitalised ("Go to Sign In").
        const forced = i === 1 || i === words || afterBreak;
        afterBreak = /[:—–·]$/.test(word) || /^[—–·|/]$/.test(word);
        // Only a word that starts with a plain lower-case letter is changed:
        // codes, numbers, e-mail addresses and paths are not words to case.
        if (!/^[(“"']?[a-z]/.test(word)) return word;
        if (word.includes('@') || word.includes('://') || /\.\w/.test(word)) return word;
        const bare = word.replace(/^[(“"']+|[)”"',;:?]+$/g, '');
        if (!forced && MINOR.has(bare)) return word;
        return word.replace(/[a-z]/, (c) => c.toUpperCase());
    });
}

/** titleCase for React children: strings are cased, everything else passes. */
export function titleCaseNode(node) {
    if (typeof node === 'string') return titleCase(node);
    if (Array.isArray(node)) return node.map((n) => (typeof n === 'string' ? titleCase(n) : n));
    return node;
}
