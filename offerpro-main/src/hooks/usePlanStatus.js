import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '../context/OrgContext';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { getPlanConfig, isLimitReached, getRemaining, getUsagePercentage, DEFAULT_PLAN } from '../services/planConfig';
import { orgStore } from '../services/orgStore';

export function usePlanStatus() {
  const { activeOrg } = useOrg();
  const [usage, setUsage] = useState({
    offerLetters: 0,
    mou: 0,
    nda: 0,
    invoices: 0,
    quotations: 0,
    aiMessages: 0,
  });
  const [loading, setLoading] = useState(true);

  const currentPlan = activeOrg?.plan || DEFAULT_PLAN;
  const planConfig = getPlanConfig(currentPlan);

  // Fetch document counts
  useEffect(() => {
    let cancelled = false;

    async function fetchUsage() {
      if (!activeOrg?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Get HR records (offer, nda, mou)
        const allRecords = await storageService.getAll(activeOrg.id);

        // Get financial docs (invoices, quotations) from fin_docs
        documentStore.setContext(activeOrg.id);
        await documentStore.init();
        const finDocs = documentStore.getAll();

        const counts = {
          offerLetters: 0,
          mou: 0,
          nda: 0,
          invoices: 0,
          quotations: 0,
          // usage_counters.ai_messages, incremented server-side by /api/nvidia.
          // This used to read `activeOrg.ai_message_count` — a column that does
          // not exist on `organizations` — so the AI quota was always 0.
          aiMessages: orgStore.getUsage().ai_messages || 0,
        };

        // Count HR records
        allRecords.forEach(record => {
          if (record.type === 'offer') counts.offerLetters++;
          else if (record.type === 'nda') counts.nda++;
          else if (record.type === 'mou') counts.mou++;
        });

        // Count invoices and quotations from fin_docs
        finDocs.forEach(doc => {
          if (doc.type === 'invoice') counts.invoices++;
          else if (doc.type === 'quotation') counts.quotations++;
        });

        if (!cancelled) {
          setUsage(counts);
        }
      } catch (err) {
        console.warn('Error fetching plan usage:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUsage();
    return () => { cancelled = true };
  }, [activeOrg?.id]);

  const canCreate = useCallback((feature) => {
    return !isLimitReached(currentPlan, feature, usage[feature]);
  }, [currentPlan, usage]);

  const getRemainingCount = useCallback((feature) => {
    return getRemaining(currentPlan, feature, usage[feature]);
  }, [currentPlan, usage]);

  const getUsagePercent = useCallback((feature) => {
    return getUsagePercentage(currentPlan, feature, usage[feature]);
  }, [currentPlan, usage]);

  const isAtLimit = useCallback((feature) => {
    return isLimitReached(currentPlan, feature, usage[feature]);
  }, [currentPlan, usage]);

  const refreshUsage = useCallback(async () => {
    if (!activeOrg?.id) return;
    
    try {
      const allRecords = await storageService.getAll(activeOrg.id);
      documentStore.setContext(activeOrg.id);
      await documentStore.init();
      const finDocs = documentStore.getAll();
      // ai_messages only changes server-side, so a recount of local rows would
      // never see a message the user just sent.
      await orgStore.refreshUsage();

      const counts = {
        offerLetters: 0,
        mou: 0,
        nda: 0,
        invoices: 0,
        quotations: 0,
        aiMessages: orgStore.getUsage().ai_messages || 0,
      };

      allRecords.forEach(record => {
        if (record.type === 'offer') counts.offerLetters++;
        else if (record.type === 'nda') counts.nda++;
        else if (record.type === 'mou') counts.mou++;
      });

      finDocs.forEach(doc => {
        if (doc.type === 'invoice') counts.invoices++;
        else if (doc.type === 'quotation') counts.quotations++;
      });

      setUsage(counts);
    } catch (err) {
      console.warn('Error refreshing usage:', err);
    }
  }, [activeOrg?.id]);

  return {
    currentPlan,
    planConfig,
    usage,
    limits: planConfig.limits,
    canCreate,
    getRemainingCount,
    getUsagePercent,
    isAtLimit,
    refreshUsage,
    loading,
  };
}
