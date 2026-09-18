/**
 * Follow-Up Engine — detects follow-up intent, fuzzy-matches employees,
 * builds AI prompts, and parses draft output.
 */

export interface FollowUpDraft {
  toName: string;
  toEmail: string;
  toPhone: string;
  employeeRole: string;
  employeeDept: string;
  tone: 'polite' | 'firm' | 'urgent';
  subject: string;
  emailBody: string;
  whatsappText: string;
}

// ── Detection ────────────────────────────────────────────────────────────────

export function detectFollowUpIntent(message: string): boolean {
  const m = message.toLowerCase().trim();

  const signals: RegExp[] = [
    /\bfollow[- ]?up\b/,
    /\bping\b/,
    /\bremind\b/,
    /\bcheck (with|on|in with)\b/,
    /\breach out to\b/,
    /\btouch base\b/,
    /\bnudge\b/,
    /\bhaven'?t heard (from|back)\b/,
    /\bno response\b/,
    /\bstill waiting\b/,
    /\bsend.{0,15}(message|email|whatsapp|text)\b/,
    /\bget back to\b/,
    /\bask.{0,20}for (an )?update\b/,
    /\bchase.{0,20}(up|him|her|them)\b/,
    /\bescalate\b/,
    /\bwhere is.{0,20}(he|she|they|the update|the status)\b/,
    /\bany update (from|on)\b/,
    /\bdrop.{0,10}(a|him|her|them).{0,10}(message|note|line)\b/,
    /\blet.{0,5}(him|her|them) know\b/,
    /\bwhat's the status (of|on|from)\b/,
  ];

  return signals.some(p => p.test(m));
}

// ── Employee matching ────────────────────────────────────────────────────────

export function getEmployeeFullName(emp: any): string {
  if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
  if (emp.studentName) return emp.studentName;
  return emp.first_name || emp.last_name || emp.name || '';
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function matchEmployee(message: string, employees: any[]): any | null {
  if (!employees || employees.length === 0) return null;

  const msgNorm  = normalize(message);
  const msgWords = msgNorm.split(/\s+/).filter(w => w.length >= 2);

  let bestMatch: any  = null;
  let bestScore       = 0;

  for (const emp of employees) {
    const fullName  = normalize(getEmployeeFullName(emp));
    if (!fullName) continue;
    const nameParts = fullName.split(/\s+/).filter(p => p.length >= 2);
    let score       = 0;

    if (msgNorm.includes(fullName)) {
      score = 100;
    } else {
      for (const part of nameParts) {
        for (const word of msgWords) {
          if (word === part) {
            score = Math.max(score, 80);
          } else if (word.startsWith(part) || part.startsWith(word)) {
            score = Math.max(score, 65);
          } else if (part.length >= 4 && levenshtein(word, part) <= 2) {
            score = Math.max(score, 55 - levenshtein(word, part) * 10);
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = emp;
    }
  }

  return bestScore >= 50 ? bestMatch : null;
}

// ── Prompt builder ───────────────────────────────────────────────────────────

export function buildFollowUpPrompt(
  userMessage: string,
  employee: any,
  rawData: string,
  companyName: string,
  userName: string,
): string {
  const empName   = getEmployeeFullName(employee);
  const firstName = employee.first_name || empName.split(' ')[0];

  return `You are the strategic AI Co-founder for ${companyName}, helping ${userName} draft a professional follow-up.

FOLLOW-UP REQUEST: "${userMessage}"

RECIPIENT:
Name: ${empName}
Role: ${employee.role || 'Team Member'}
Department: ${employee.department || 'General'}

COMPANY CONTEXT:
${rawData || 'No additional context available.'}

Output EXACTLY in this format — start with TONE: and end after the WhatsApp text, nothing else:

TONE: [polite|firm|urgent]
SUBJECT: [concise subject, max 8 words, no trailing period]
EMAIL:
Hi ${firstName},

[2–4 sentences. Specific to the context in the user's request. Professional, direct. Clear next step or deadline.]

Best regards,
${userName}
WHATSAPP:
Hey ${firstName}, [1–2 sentences. Same context, shorter, slightly casual but professional.]

TONE GUIDE:
- urgent: overdue deadline, blocking work, critical, multiple follow-ups ignored
- firm: important deliverable, awaiting response, second follow-up
- polite: first reminder, routine check-in, general update request

STRICT RULES:
- Never use "hope this email finds you well", "just wanted to", "touching base", "circling back"
- Reference the specific task or project from the user's message
- EMAIL total max 80 words including greeting and sign-off
- WHATSAPP max 40 words`;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseFollowUpResponse(content: string, employee: any): FollowUpDraft | null {
  const text = content.trim();

  const toneMatch    = text.match(/^TONE:\s*(polite|firm|urgent)/im);
  const subjectMatch = text.match(/^SUBJECT:\s*(.+)/im);
  const emailMatch   = text.match(/EMAIL:\n([\s\S]+?)(?=\nWHATSAPP:)/i);
  const waMatch      = text.match(/WHATSAPP:\n([\s\S]+?)$/i);

  if (!toneMatch || !subjectMatch || !emailMatch) return null;

  return {
    toName:       getEmployeeFullName(employee),
    toEmail:      employee.email      || '',
    toPhone:      employee.phone      || '',
    employeeRole: employee.role       || '',
    employeeDept: employee.department || '',
    tone:         toneMatch[1] as 'polite' | 'firm' | 'urgent',
    subject:      subjectMatch[1].trim(),
    emailBody:    emailMatch[1].trim(),
    whatsappText: waMatch ? waMatch[1].trim() : '',
  };
}
