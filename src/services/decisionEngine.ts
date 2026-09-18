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

  // Enforce minimum 3 questions before allowing a final recommendation.
  // This prevents the model from immediately concluding based on question phrasing.
  const phaseInstruction =
    ctx.questionCount <= 1
      ? `You MUST ask a clarifying question — outputting DECISION: at this stage is FORBIDDEN.
Start your response with QUESTION:`
      : ctx.questionCount >= 5
      ? 'You have gathered enough context. Give the final recommendation now. Start your response with DECISION:'
      : ctx.questionCount >= 4
      ? 'If you have strong evidence for a confident recommendation, start with DECISION: Otherwise start with QUESTION: and ask one more.'
      : 'Ask one more focused question. Start your response with QUESTION:';

  return `You are the strategic AI Co-founder for ${companyName}, speaking directly to ${userName}.
You are in DECISION MODE — helping ${userName} make a well-informed, data-backed decision.

DECISION TOPIC: "${ctx.topic}"
${answersSection}

LIVE COMPANY DATA:
${rawData || 'No company data available.'}

${phaseInstruction}

⚠️  CRITICAL ANTI-BIAS RULE:
Your recommendation MUST be based on the COMPANY DATA and GATHERED ANSWERS — NOT on how the question was phrased.
If the user asked "should I hire when there is no need?", do NOT simply confirm their framing.
Analyse the actual data (revenue, team size, workload, tasks, cash) and give an honest, objective answer.
The same data should produce the same recommendation regardless of question wording.

RESPONSE FORMAT — choose exactly one:

To ask a clarifying question:
QUESTION: [One focused question — the most critical unknown, 1 sentence]
OPTIONS: [2–6 word option] | [2–6 word option] | [2–6 word option] | [2–6 word option]

To give the final recommendation (only after enough context):
DECISION: [Clear yes/no/which option — one direct sentence grounded in data]
WHY: [specific data-backed reason] | [specific reason] | [specific reason]
RISKS: [concrete risk] | [concrete risk]
NEXT_STEP: [One specific action to take this week]

STRICT OUTPUT RULES:
1. Start ENTIRELY with QUESTION: or DECISION: — no preamble, no extra text before it.
2. QUESTION: on line 1. OPTIONS: on line 2 immediately after. SEPARATE LINES — never the same line.
3. OPTIONS are short answer choices (2–6 words each) separated by |. Never restate the question as an option.
4. DECISION must cite actual numbers or facts from the company data above. No invented data.
5. Do not repeat questions already answered.

CORRECT EXAMPLE:
QUESTION: Do you have budget allocated for this hire?
OPTIONS: Yes, fully allocated | No budget yet | Partially available | Still planning

WRONG (never do this):
QUESTION: Do you have budget? OPTIONS: Yes | No   ← OPTIONS must be on its own line`;
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

  // Locate QUESTION: — may appear after model preamble (multiline + case-insensitive)
  const questionMatch = trimmed.match(/^QUESTION:\s*(.+)/im);

  if (questionMatch) {
    let questionText = questionMatch[1].trim();
    let optionText   = '';

    // Case A: model put OPTIONS: on the SAME LINE as QUESTION:
    // e.g. "QUESTION: Do you have budget? OPTIONS: Yes | No | Maybe"
    const inlineOpts = questionText.match(/\s+OPTIONS:\s*(.+)$/i);
    if (inlineOpts) {
      optionText   = inlineOpts[1];
      questionText = questionText.replace(/\s+OPTIONS:\s*.+$/i, '').trim();
    } else {
      // Case B: OPTIONS: on a separate line (normal format)
      const optionsMatch = trimmed.match(/^OPTIONS:\s*(.+)/im);
      if (optionsMatch) optionText = optionsMatch[1];
    }

    // Parse pipe-separated option list
    const rawOptions = optionText
      ? optionText.split('|').map(o => o.trim()).filter(Boolean)
      : [];

    // Strip options that are placeholder templates or duplicate the question text
    const qPrefix = questionText.toLowerCase().substring(0, 25);
    const options = rawOptions.filter(o => {
      const ol = o.toLowerCase();
      return (
        ol !== qPrefix &&
        !ol.startsWith(qPrefix) &&
        !o.includes('[') &&          // filter "[2–6 word option]" template leftovers
        o.length > 0
      );
    });

    return { ...base, type: 'question', question: questionText, options };
  }

  const decisionMatch = trimmed.match(/^DECISION:\s*(.+)/im);
  const whyMatch      = trimmed.match(/^WHY:\s*(.+)/im);
  const risksMatch    = trimmed.match(/^RISKS:\s*(.+)/im);
  const nextStepMatch = trimmed.match(/^NEXT_STEP:\s*(.+)/im);

  if (decisionMatch) {
    const decision = decisionMatch[1].trim();
    const why      = whyMatch      ? whyMatch[1].split('|').map(w => w.trim()).filter(Boolean)   : [];
    const risks    = risksMatch    ? risksMatch[1].split('|').map(r => r.trim()).filter(Boolean) : [];
    const nextStep = nextStepMatch ? nextStepMatch[1].trim()                                      : '';
    return { ...base, type: 'final', decision, why, risks, nextStep };
  }

  // Model returned unstructured text — treat as plain final response
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
