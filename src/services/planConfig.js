/**
 * EdgeOS Plan Configuration
 * Three tiers: Free, Pro, Max
 */

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    displayName: 'Free Plan',
    color: '#64748b', // slate
    limits: {
      offerLetters: 5,
      mou: 1,
      nda: 1,
      invoices: 5,
      quotations: 5,
      aiMessages: 10,
      bulkOperations: false,
      prioritySupport: false,
      recipientPortal: true,
      teamFollowUp: false,
    }
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    displayName: 'Pro Plan',
    color: '#8b5cf6', // purple
    limits: {
      offerLetters: 25,
      mou: 5,
      nda: 5,
      invoices: 20,
      quotations: 20,
      aiMessages: 50,
      bulkOperations: false,
      prioritySupport: true,
      recipientPortal: true,
      teamFollowUp: false,
    }
  },
  max: {
    id: 'max',
    name: 'Max',
    displayName: 'Max Plan',
    color: '#10b981', // emerald
    limits: {
      offerLetters: Infinity,
      mou: Infinity,
      nda: Infinity,
      invoices: Infinity,
      quotations: Infinity,
      aiMessages: Infinity,
      bulkOperations: true,
      prioritySupport: true,
      recipientPortal: true,
      teamFollowUp: true,
    }
  }
};

export const DEFAULT_PLAN = 'free';

export function getPlanConfig(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

export function isLimitReached(planId, feature, currentCount) {
  const plan = getPlanConfig(planId);
  const limit = plan.limits[feature];
  if (limit === Infinity) return false;
  return currentCount >= limit;
}

export function getRemaining(planId, feature, currentCount) {
  const plan = getPlanConfig(planId);
  const limit = plan.limits[feature];
  if (limit === Infinity) return 'unlimited';
  return Math.max(0, limit - currentCount);
}

export function getUsagePercentage(planId, feature, currentCount) {
  const plan = getPlanConfig(planId);
  const limit = plan.limits[feature];
  if (limit === Infinity) return 0;
  return Math.min(100, (currentCount / limit) * 100);
}

export const PLAN_FEATURES = {
  offerLetters: { label: 'Offer Letters', icon: 'Briefcase' },
  mou: { label: 'MoU Documents', icon: 'Handshake' },
  nda: { label: 'NDA Documents', icon: 'Shield' },
  invoices: { label: 'Invoices', icon: 'Receipt' },
  quotations: { label: 'Quotations', icon: 'FileText' },
  aiMessages: { label: 'AI Co-founder Messages', icon: 'Zap' },
};
