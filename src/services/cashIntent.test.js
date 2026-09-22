import { describe, it, expect } from 'vitest';
import {
  detectCashIntent, parseAmount, parseDate, parseMethod, parseGstRate,
  parseCashSentence, startDraft, nextQuestion, applyAnswer, validateDraft,
  toEntry, taxFromRate, baseAmount, guessCategory, isCancel, isQuestion, amountHints,
} from './cashIntent';

// The taxonomy is not loaded in a unit test and deliberately is not needed:
// guessCategory falls back to its synonym table when finance_categories has
// not been fetched, and every other function here works off the draft alone.
// A test that had to seed a remote table to check that "yesterday" is a date
// would be testing the wrong thing.

const TODAY = '2026-09-22';

describe('detectCashIntent — recording versus asking', () => {
  it('reads spending as money out', () => {
    expect(detectCashIntent('we spent 4500 on office chairs')).toEqual({ direction: 'out', certain: true });
    expect(detectCashIntent('paid the October rent')).toEqual({ direction: 'out', certain: true });
  });

  it('reads receipts as money in', () => {
    expect(detectCashIntent('received 60000 from Acme')).toEqual({ direction: 'in', certain: true });
    expect(detectCashIntent('collected 1.2 lakh in counter sales')).toEqual({ direction: 'in', certain: true });
  });

  it('asks which way when a sentence says both, or neither', () => {
    expect(detectCashIntent('log a cash entry')).toEqual({ direction: null, certain: false });
    expect(detectCashIntent('received a refund and paid it back')).toEqual({ direction: null, certain: false });
  });

  it('never starts an entry from a question', () => {
    expect(detectCashIntent('how much did we spend last month?')).toBeNull();
    expect(detectCashIntent('what were our expenses in August')).toBeNull();
    expect(detectCashIntent('show me everything we paid Acme')).toBeNull();
  });

  it('reads a question that does not begin with the question', () => {
    // People lead with a filler word constantly. Anchoring the test to the
    // first word turned each of these into a form.
    expect(detectCashIntent('okay how much is the expenses')).toBeNull();
    expect(detectCashIntent('hey what did we pay in rent')).toBeNull();
    expect(detectCashIntent('so which expenses are unrecorded')).toBeNull();
    expect(detectCashIntent('and how many invoices went out')).toBeNull();
    expect(detectCashIntent('What is the toal revenue!!')).toBeNull();
  });

  it('still records when the same words are used to tell, not to ask', () => {
    expect(detectCashIntent('okay we paid 25000 rent today')).toEqual({ direction: 'out', certain: true });
    expect(detectCashIntent('hey we got to add some expenses now')).toEqual({ direction: 'out', certain: true });
  });

  it('leaves an observation about money to the model', () => {
    // Nothing moved and nothing was asked to be written down.
    expect(detectCashIntent('our margins look thin this quarter')).toBeNull();
    expect(detectCashIntent('the books should be reconciled weekly')).toBeNull();
  });

  it('ignores a message that is not about money at all', () => {
    expect(detectCashIntent('draft an offer letter for Priya')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('reads plain and grouped figures', () => {
    expect(parseAmount('4500').amount).toBe(4500);
    expect(parseAmount('paid 25,000 rent').amount).toBe(25000);
  });

  it('applies Indian and metric scale words', () => {
    expect(parseAmount('2 lakh').amount).toBe(200000);
    expect(parseAmount('1.2 cr').amount).toBe(12000000);
    expect(parseAmount('4.5k').amount).toBe(4500);
  });

  it('takes the currency from the symbol beside the figure', () => {
    expect(parseAmount('$1,200')).toMatchObject({ amount: 1200, currency: 'USD' });
    expect(parseAmount('₹4500')).toMatchObject({ amount: 4500, currency: 'INR' });
    expect(parseAmount('1200 USD')).toMatchObject({ amount: 1200, currency: 'USD' });
  });

  it('never mistakes a rate for a sum', () => {
    expect(parseAmount('18%')).toBeNull();
  });

  it('prefers the figure wearing a currency over a bare number', () => {
    expect(parseAmount('invoice 12 for $900')).toMatchObject({ amount: 900, currency: 'USD' });
  });

  it('returns nothing when there is no figure', () => {
    expect(parseAmount('office chairs')).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads the relative words people actually use', () => {
    expect(parseDate('today', TODAY).date).toBe('2026-09-22');
    expect(parseDate('yesterday', TODAY).date).toBe('2026-09-21');
    expect(parseDate('day before yesterday', TODAY).date).toBe('2026-09-20');
    expect(parseDate('3 days ago', TODAY).date).toBe('2026-09-19');
  });

  it('reads written and numeric dates, day first', () => {
    expect(parseDate('on 5 Oct', TODAY).date).toBe('2026-10-05');
    expect(parseDate('Sept 3', TODAY).date).toBe('2026-09-03');
    expect(parseDate('05/09/2026', TODAY).date).toBe('2026-09-05');
    expect(parseDate('2026-08-14', TODAY).date).toBe('2026-08-14');
  });

  it('reads a year-less date far in the future as last year’s', () => {
    // A couple of weeks ahead is somebody writing an entry early; ten months
    // ahead is a date from last year with the year left off.
    expect(parseDate('5 Oct', TODAY).date).toBe('2026-10-05');
    expect(parseDate('12 Dec', '2026-02-01').date).toBe('2025-12-12');
  });

  it('returns nothing when no date was named', () => {
    expect(parseDate('office chairs', TODAY)).toBeNull();
  });
});

describe('parseMethod and parseGstRate', () => {
  it('names the rail', () => {
    expect(parseMethod('paid by UPI').method).toBe('upi');
    expect(parseMethod('in cash').method).toBe('cash');
    expect(parseMethod('NEFT transfer').method).toBe('bank_transfer');
    expect(parseMethod('on the company card').method).toBe('card');
    expect(parseMethod('nothing here')).toBeNull();
  });

  it('only takes an explicit GST rate', () => {
    expect(parseGstRate('18% GST').rate).toBe(18);
    expect(parseGstRate('gst at 5%').rate).toBe(5);
    expect(parseGstRate('plus GST')).toBeNull();
  });

  it('carves tax out of the gross rather than adding it on', () => {
    expect(taxFromRate(11800, 18)).toBe(1800);
    expect(taxFromRate(1000, 0)).toBe(0);
  });
});

describe('parseCashSentence — one line, every field', () => {
  it('pulls the amount, date, method and description apart', () => {
    const patch = parseCashSentence('spent 4500 on office chairs yesterday via UPI', 'out', TODAY);
    expect(patch.original_amount).toBe('4500');
    expect(patch.date).toBe('2026-09-21');
    expect(patch.payment_method).toBe('upi');
    expect(patch.description.toLowerCase()).toContain('office chairs');
  });

  it('does not let a date be read as the amount', () => {
    const patch = parseCashSentence('paid 25000 rent on 5 Oct', 'out', TODAY);
    expect(patch.original_amount).toBe('25000');
    expect(patch.date).toBe('2026-10-05');
  });

  it('keeps the GST rate out of the amount', () => {
    const patch = parseCashSentence('paid 11800 including 18% GST', 'out', TODAY);
    expect(patch.original_amount).toBe('11800');
    expect(patch.tax_rate).toBe(18);
  });

  it('carries a foreign currency through', () => {
    const patch = parseCashSentence('received $1,200 from a client', 'in', TODAY);
    expect(patch.original_amount).toBe('1200');
    expect(patch.currency).toBe('USD');
  });
});

describe('guessCategory', () => {
  it('maps what people say onto what the taxonomy calls it', () => {
    expect(guessCategory('new laptop for the designer', 'out')).toBe('computers');
    expect(guessCategory('office chairs', 'out')).toBe('furniture');
    expect(guessCategory('October rent', 'out')).toBe('rent');
    expect(guessCategory('salary run for September', 'out')).toBe('salaries');
    expect(guessCategory('GST remitted for August', 'out')).toBe('gst_paid');
    expect(guessCategory('investor money', 'in')).toBe('investment_received');
  });

  it('leaves a sentence it cannot place unguessed, rather than filing it wrong', () => {
    expect(guessCategory('the thing from the place', 'out')).toBeNull();
  });
});

describe('the conversation', () => {
  it('asks only for what the first message did not say', () => {
    const draft = startDraft('spent 4500 on office chairs yesterday via UPI', 'out', TODAY);
    // Amount, description, category, date and method were all in the sentence,
    // so there is nothing left to ask — it goes straight to the review card.
    expect(nextQuestion(draft)).toBeNull();
    expect(validateDraft(draft)).toEqual([]);
  });

  it('asks the direction first when the sentence did not say', () => {
    const draft = startDraft('log a cash entry', null, TODAY);
    expect(nextQuestion(draft).slot).toBe('direction');
  });

  it('walks an empty draft through one question at a time', () => {
    let draft = startDraft('record an expense', 'out', TODAY);

    expect(nextQuestion(draft).slot).toBe('amount');
    draft = applyAnswer(draft, 'amount', '4500', TODAY).draft;

    expect(nextQuestion(draft).slot).toBe('description');
    draft = applyAnswer(draft, 'description', 'office chairs', TODAY).draft;

    // The description named a category, so that question is already answered.
    expect(nextQuestion(draft).slot).toBe('payment_method');
    draft = applyAnswer(draft, 'payment_method', 'cash', TODAY).draft;

    expect(nextQuestion(draft)).toBeNull();
    expect(draft.category).toBe('furniture');
    expect(draft.date).toBe(TODAY);
  });

  it('takes everything an answer contains, not just the slot it was asked for', () => {
    let draft = startDraft('record an expense', 'out', TODAY);
    draft = applyAnswer(draft, 'amount', '4500 by UPI yesterday', TODAY).draft;
    expect(draft.original_amount).toBe('4500');
    expect(draft.payment_method).toBe('upi');
    expect(draft.date).toBe('2026-09-21');
  });

  it('refuses an answer it cannot read, without losing the draft', () => {
    const draft = startDraft('record an expense', 'out', TODAY);
    const res = applyAnswer(draft, 'amount', 'quite a lot', TODAY);
    expect(res.draft).toBeUndefined();
    expect(res.error).toMatch(/figure/i);
  });

  it('keeps what still applies when the direction changes', () => {
    let draft = startDraft('log a cash entry of 5000 yesterday', null, TODAY);
    draft = applyAnswer(draft, 'direction', 'money in', TODAY).draft;
    expect(draft.direction).toBe('in');
    expect(draft.original_amount).toBe('5000');
    expect(draft.date).toBe('2026-09-21');
    expect(draft.category).toBe('');
  });
});

describe('getting out, and asking something else', () => {
  it('lets someone back out mid-sentence, not just at the start of one', () => {
    expect(isCancel('Okay leave it')).toBe(true);
    expect(isCancel('actually never mind')).toBe(true);
    expect(isCancel('cancel')).toBe(true);
    expect(isCancel('not now, maybe later')).toBe(true);
  });

  it('does not read an ordinary answer as a cancellation', () => {
    expect(isCancel('4500')).toBe(false);
    expect(isCancel('office chairs')).toBe(false);
    // "stop" on its own is backing out; a shop called Stop & Shop is not.
    expect(isCancel('paid Stop and Shop')).toBe(false);
  });

  it('recognises a question asked in the middle of an entry', () => {
    expect(isQuestion('the amount which is left unrecorded?')).toBe(true);
    expect(isQuestion('how much is left')).toBe(true);
    expect(isQuestion('4500')).toBe(false);
  });

  it('refuses to read a question as an answer, so it can be answered instead', () => {
    const draft = startDraft('record an expense', 'out', TODAY);
    // No figure in it, so applyAnswer declines and the caller is free to send
    // the question to the model rather than rejecting it at the person.
    expect(applyAnswer(draft, 'amount', 'the amount which is left unrecorded?', TODAY).draft)
      .toBeUndefined();
  });
});

describe('amountHints — figures the conversation already named', () => {
  it('offers back a figure from an earlier message', () => {
    const hints = amountHints([
      'I recommend checking your latest bank statement against our recorded expenses.',
      'Combined bank charges around ₹2,615 so we can log them and keep the books accurate.',
    ]);
    expect(hints[0].value).toBe('2615');
    // Named from the words in front of the figure — not the clause after it,
    // which in this sentence is "so we can log them".
    expect(hints[0].label).toBe('₹2,615 · bank charges');
  });

  it('takes the most recent figures first, without repeating one', () => {
    const hints = amountHints(['paid ₹1,000', 'then ₹2,000', 'and ₹2,000 again']);
    expect(hints.map((h) => h.value)).toEqual(['2000', '1000']);
  });

  it('ignores bare numbers that were never presented as sums', () => {
    expect(amountHints(['we have 5 invoices and 12 customers'])).toEqual([]);
  });

  it('has nothing to offer from a conversation with no figures in it', () => {
    expect(amountHints(['how are the books looking?', 'fine, nothing outstanding'])).toEqual([]);
  });
});

describe('validateDraft and toEntry', () => {
  const ready = () => ({
    ...startDraft('spent 4500 on office chairs yesterday via UPI', 'out', TODAY),
  });

  it('names everything missing', () => {
    const problems = validateDraft({ ...ready(), original_amount: '0', description: '' });
    expect(problems).toContain('Enter an amount greater than zero.');
    expect(problems).toContain('Say what this was for.');
  });

  it('refuses GST larger than the amount it is part of', () => {
    expect(validateDraft({ ...ready(), tax_amount: '9999' }))
      .toContain('The GST cannot be more than the amount it is part of.');
  });

  it('routes each direction to its own table and drops the direction itself', () => {
    const out = toEntry(ready());
    expect(out.section).toBe('expenses');
    expect(out.data.direction).toBeUndefined();
    expect(out.data.original_amount).toBe(4500);

    const inward = toEntry({ ...ready(), direction: 'in' });
    expect(inward.section).toBe('income_entries');
  });

  it('converts a foreign amount at the rate that was entered', () => {
    const draft = { ...ready(), original_amount: '1200', currency: 'USD', fx_rate: 83.5 };
    expect(baseAmount(draft)).toBe(100200);
  });
});
