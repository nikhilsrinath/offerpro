import { describe, it, expect } from 'vitest';
import { wbsContext, parseSuggestion } from './wbsSuggest.js';

describe('wbsContext', () => {
    it('refuses to go on with nothing that says what the work is', () => {
        const c = wbsContext({ org: { company_name: 'Acme' }, project: { name: 'Phase 2' } });
        expect(c.enough).toBe(false);
        expect(c.missing).toEqual(['project_description', 'industry']);
    });

    it('goes on with an industry or a description, and lists the facts', () => {
        const c = wbsContext({
            org: { industry: 'Pharmaceuticals' }, project: { name: 'Line 3', tags: ['GMP'] },
            client: { name: 'MedCo', industry: 'Healthcare' }, milestones: [{ title: 'IQ/OQ' }], existing: [{ title: 'Validation' }],
        });
        expect(c.enough).toBe(true);
        expect(c.missing).toEqual(['project_description']);
        expect(c.text).toContain('Company industry: Pharmaceuticals');
        expect(c.text).toContain('Client: MedCo (Healthcare)');
        expect(c.text).toContain('Sub-projects already in the WBS: Validation');
    });
});

describe('parseSuggestion', () => {
    it('reads a fenced JSON breakdown into [name, children] nodes', () => {
        const raw = '```json\n{"enough_context":true,"industry":"Pharma","summary":"GMP","nodes":[{"name":"Validation","children":[{"name":"IQ","children":[{"name":"Protocol"}]},{"name":"OQ"}]},{"name":"Release"}]}\n```';
        expect(parseSuggestion(raw)).toEqual({
            enough: true, industry: 'Pharma', summary: 'GMP',
            nodes: [['Validation', [['IQ', ['Protocol']], 'OQ']], ['Release', []]],
        });
    });

    it('passes on the model saying it lacks context', () => {
        expect(parseSuggestion('{"enough_context": false, "missing": ["what the project delivers"]}'))
            .toEqual({ enough: false, missing: ['what the project delivers'] });
    });

    it('rejects prose and empty breakdowns', () => {
        expect(parseSuggestion('Sure! Here is a plan.')).toBeNull();
        expect(parseSuggestion('{"enough_context": true, "nodes": []}')).toBeNull();
    });

    it('caps depth at three levels', () => {
        const r = parseSuggestion(JSON.stringify({ nodes: [{ name: 'A', children: [{ name: 'B', children: [{ name: 'C', children: [{ name: 'D' }] }] }] }] }));
        expect(r.nodes).toEqual([['A', [['B', ['C']]]]]);
    });
});
