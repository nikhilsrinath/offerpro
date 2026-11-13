// dealLinks.js: what other screens need to know about a CRM deal, kept out
// of the CRM's own components so a form can import it cheaply.
import { useSection } from '../financial/financeHooks';
import { orgStore } from '../../services/orgStore';
import { stageChange } from './dealModel';

/** The CRM page with a deal open, on one of its tabs. */
export const dealPath = (dealId, tab) =>
    `/clients/crm?deal=${encodeURIComponent(dealId)}${tab ? `&tab=${tab}` : ''}`;

/** For a form opened from a deal (New Quote): the deal, its client, and where
    to go back to. Everything is null when the form was not opened from one. */
export function useDealForForm(dealId) {
    const deals = useSection('crm_deals');
    const customers = useSection('customers');
    const deal = dealId ? deals.find((d) => d.id === dealId) || null : null;
    const client = deal?.client_id ? customers.find((c) => c.id === deal.client_id) || null : null;
    return { deal, client, returnTo: deal ? dealPath(deal.id, 'related') : null };
}

/** Puts a saved quotation on the deal. Never throws: the quotation is saved
    either way, and it can be linked from the deal's Quotes section. */
export async function linkQuoteToDeal(deal, quoteId) {
    if (!deal || !quoteId) return;
    const fresh = orgStore.getItem('crm_deals', deal.id) || deal;
    const ids = fresh.quote_ids || [];
    if (ids.includes(quoteId)) return;
    try {
        await orgStore.updateItem('crm_deals', deal.id, {
            quote_ids: [...ids, quoteId],
            // A quotation sent is the Proposal stage, if the deal had not got there.
            ...(['lead', 'contacted', 'qualified'].includes(fresh.stage) && fresh.state === 'open' ? stageChange(fresh, 'proposal') : {}),
        });
    } catch (err) {
        console.warn('[crm] linking the quotation failed:', err.message);
    }
}
