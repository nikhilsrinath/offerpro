/**
 * Decision Engine — Strategic decision mode for Co-founder AI
 *
 * Detects when a user needs a structured decision rather than a direct answer,
 * manages the iterative question flow, and formats the final recommendation.
 */

export interface DecisionAnswer {
  question: string;
  answer: string;
}

export interface DecisionContext {
  topic: string;
  answers: DecisionAnswer[];
  questionCount: number;
}

export interface ParsedDecisionResponse {
  type: 'question' | 'final';
  question: string;
  options: string[];
  decision: string;
  why: string[];
  risks: string[];
  nextStep: string;
  rawContent: string;
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect if a user message requires strategic decision mode.
 * Pattern-based — no trigger keywords required.
 */
export function detectDecisionIntent(message: string): boolean {
  const m = message.toLowerCase().trim();

  // Skip purely factual or command queries
  const commandPrefixes = [
    'what is ', 'what are ', 'how many ', 'how much ', 'tell me ',
    'show me ', 'list ', 'generate ', 'create ', 'make ', 'write ',
    'calculate ', 'summarize ', 'display ', 'give me the ',
    'who is ', 'when did ', 'where is ',
  ];
  if (commandPrefixes.some(p => m.startsWith(p))) return false;

  const signals: RegExp[] = [
    // "Should I/we ..."
    /^should (i|we|the team|our company)\b/,
    // "Is it / Would it be worth..."
    /^(is it|would it be?) (worth|a good idea|better|smarter|wise|the right move)\b/,
    // "Is now/this the right time..."
    /^is (now|this) (a good|the right) time\b/,
    // "Help me/us decide/choose/think through..."
    /\bhelp (me|us) (decide|choose|pick|think through|figure out|work out)\b/,
    // "What should/would I/we do..."
    /^what (should|would) (i|we|you) (do|recommend|suggest|advise)\b/,
    // Consideration phrases with action verbs
    /\b(thinking (about|of)|considering|planning to|debating (whether|if)|wondering whether|not sure (whether|if))\b/,
    // X vs Y
    /\b\w[\w\s]{1,20} vs\.? [\w\s]{1,20}\b/i,
    // Worth it
    /\bworth (it|the risk|the cost|the time|the investment|the effort)\b/,
    // Good/bad/right decision
    /\b(good|bad|right|wrong|smart|wise|risky) (idea|move|decision|call|choice|bet)\b/,
    // "Should I/we hire/launch/pivot..."
    /\b(do i|do we|should i|should we|can i|can we) (hire|fire|launch|pivot|invest|partner|expand|cut|raise|lower|switch|outsource|build|buy|sell|drop|scale)\b/,
    // Any strategic verb + question mark
    /\b(hire|launch|pivot|expand|invest|partner|outsource|scale|rebrand|restructure)\b.{0,60}\?$/,
    // "I'm/We're thinking/considering..."
    /^(i'?m|we'?re) (thinking|considering|planning|debating|wondering)\b/,
    // "Advice on/about..."
    /\badvice (on|about|for|regarding)\b/,
    // "What's your recommendation/take..."
    /\bwhat('s| is) (your|the) (recommendation|take|opinion|view|thought)\b/,
    // "Should/Can I afford/justify/risk..."
    /^(should|can|could) (i|we) (afford|justify|risk)\b/,
  ];

  return signals.some(p => p.test(m));
}

// ── Context ──────────────────────────────────────────────────────────────────

export function createDecisionContext(topic: string): DecisionContext {
  return { topic, answers: [], questionCount: 0 };
}

export function addDecisionAnswer(
  ctx: DecisionContext,
  question: string,
  answer: string,
): DecisionContext {
  return {
    ...ctx,
    answers: [...ctx.answers, { question, answer }],
    questionCount: ctx.questionCount + 1,
  };
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

export function buildDecisionPrompt(
  ctx: DecisionContext,
  rawData: string,
  companyName: string,
  userName: string,
): string {
  const answersSection =
    ctx.answers.length > 0
      ? '\nCONTEXT GATHERED:\n' +
        ctx.answers
          .map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`)
          .join('\n\n')
      : '\n(No context yet — this is the first question.)';

  const phaseInstruction =
    ctx.questionCount === 0
      ? 'Ask the FIRST clarifying question. Start your response with QUESTION:'
      : ctx.questionCount >= 5
      ? 'You have enough context. Give the final recommendation now. Start your response with DECISION:'
      : ctx.questionCount >= 3
      ? 'If you have enough to give a confident recommendation, start with DECISION: Otherwise start with QUESTION: and ask one more.'
      : 'Ask one more focused question. Start your response with QUESTION:';

  return `You are the strategic AI Co-founder for ${companyName}, speaking directly to ${userName}.
You are in DECISION MODE — helping ${userName} reach a well-informed decision.

DECISION TOPIC: "${ctx.topic}"
${answersSection}

LIVE COMPANY DATA:
${rawData || 'No company data available.'}

${phaseInstruction}

RESPONSE FORMAT — choose exactly one:

To ask one more clarifying question:
QUESTION: [One focused question — the most critical unknown, 1 sentence]
OPTIONS: [2–6 word option] | [2–6 word option] | [2–6 word option] | [2–6 word option]

To give the final recommendation:
DECISION: [Clear yes/no/which option — one direct sentence]
WHY: [specific reason using company data or gathered answers] | [specific reason] | [specific reason]
RISKS: [concrete risk] | [concrete risk]
NEXT_STEP: [One specific action to take this week]

STRICT OUTPUT RULES:
- Your response MUST start with either the word QUESTION: or the word DECISION: — nothing before it.
- Do NOT write "FORMAT A:", "FORMAT B:", or any other label. Start directly with QUESTION: or DECISION:.
- When you write QUESTION:, you MUST write OPTIONS: on the very next line — OPTIONS are mandatory, never skip them.
- OPTIONS: must contain exactly 3–5 choices separated by |. Each choice must be 2–7 words. No punctuation at end of choices.
- For DECISION: — use only facts from company data + gathered context. No invented data.
- Avoid repeating questions already answered above.
- Prioritise uncovered dimensions: financial impact, team capacity, urgency, alternatives, downside risk.`;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseDecisionResponse(content: string): ParsedDecisionResponse {
  const trimmed = content.trim();

  const base: ParsedDecisionResponse = {
    type: 'final',
    question: '',
    options: [],
    decision: '',
    why: [],
    risks: [],
    nextStep: '',
    rawContent: content,
  };

  // Use multiline flag so QUESTION:/DECISION: is found even when the model
  // prefixes the response with "FORMAT A:" or similar preamble.
  const questionMatch = trimmed.match(/^QUESTION:\s*(.+)/im);
  const optionsMatch  = trimmed.match(/^OPTIONS:\s*(.+)/im);

  if (questionMatch) {
    const question = questionMatch[1].trim();
    const options = optionsMatch
      ? optionsMatch[1].split('|').map(o => o.trim()).filter(Boolean)
      : [];
    return { ...base, type: 'question', question, options };
  }

  const decisionMatch  = trimmed.match(/^DECISION:\s*(.+)/im);
  const whyMatch       = trimmed.match(/^WHY:\s*(.+)/im);
  const risksMatch     = trimmed.match(/^RISKS:\s*(.+)/im);
  const nextStepMatch  = trimmed.match(/^NEXT_STEP:\s*(.+)/im);

  if (decisionMatch) {
    const decision = decisionMatch[1].trim();
    const why      = whyMatch      ? whyMatch[1].split('|').map(w => w.trim()).filter(Boolean)      : [];
    const risks    = risksMatch    ? risksMatch[1].split('|').map(r => r.trim()).filter(Boolean)    : [];
    const nextStep = nextStepMatch ? nextStepMatch[1].trim()                                         : '';
    return { ...base, type: 'final', decision, why, risks, nextStep };
  }

  // Couldn't parse structured format — show raw as a plain final response
  return base;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatDecisionFinalText(parsed: ParsedDecisionResponse): string {
  if (parsed.type === 'question') return parsed.question;

  if (!parsed.decision && !parsed.why.length) return parsed.rawContent;

  let text = '';
  if (parsed.decision) text += `${parsed.decision}\n\n`;
  if (parsed.why.length) {
    text += `Why this is right:\n${parsed.why.map(w => `• ${w}`).join('\n')}\n\n`;
  }
  if (parsed.risks.length) {
    text += `Risks to manage:\n${parsed.risks.map(r => `• ${r}`).join('\n')}\n\n`;
  }
  if (parsed.nextStep) {
    text += `Next step: ${parsed.nextStep}`;
  }
  return text.trim();
}
