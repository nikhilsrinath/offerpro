import { useState, useEffect } from 'react';
import { storageService } from '../services/storageService';
import { useOrg } from '../context/OrgContext';

const TRIAL_DURATION_DAYS = 7;

export const TRIAL_LIMITS = {
    offer: 5,
    nda: 1,
    mou: 1,
    invoice: 5
};

export function useTrialStatus() {
    const { activeOrg } = useOrg();
    const [usage, setUsage] = useState({ offer: 0, nda: 0, mou: 0, invoice: 0 });
    const [loading, setLoading] = useState(true);

    const isPremium = activeOrg?.is_premium || false;

    // Calculate trial days info from org data
    const trialStartDate = activeOrg?.trial_start_date
        ? new Date(activeOrg.trial_start_date)
        : activeOrg?.created_at
            ? new Date(activeOrg.created_at)
            : null;

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const daysSinceStart = trialStartDate
        ? Math.floor((now - trialStartDate) / msPerDay)
        : 0;

    const trialDaysLeft = Math.max(0, TRIAL_DURATION_DAYS - daysSinceStart);
    // If premium, trial never expires
    const isTrialExpired = isPremium ? false : (trialStartDate ? daysSinceStart >= TRIAL_DURATION_DAYS : false);

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
                const allRecords = await storageService.getAll(activeOrg.id);

                const counts = { offer: 0, nda: 0, mou: 0, invoice: 0 };
                allRecords.forEach(record => {
                    if (record.type === 'offer') counts.offer++;
                    else if (record.type === 'nda') counts.nda++;
                    else if (record.type === 'mou') counts.mou++;
                    else if (record.type === 'invoice') counts.invoice++;
                });

                if (!cancelled) {
                    setUsage(counts);
                }
            } catch (err) {
                console.warn('Error fetching trial usage:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        fetchUsage();
        return () => { cancelled = true; };
    }, [activeOrg?.id]);

    const canCreate = (type) => {
        if (isPremium) return true; // Premium has unlimited access
        if (isTrialExpired) return false;
        const limit = TRIAL_LIMITS[type];
        if (limit === undefined) return true;
        return usage[type] < limit;
    };

    // Refresh usage counts (call after creating a document)
    const refreshUsage = async () => {
        if (!activeOrg?.id) return;
        try {
            const allRecords = await storageService.getAll(activeOrg.id);
            const counts = { offer: 0, nda: 0, mou: 0, invoice: 0 };
            allRecords.forEach(record => {
                if (record.type === 'offer') counts.offer++;
                else if (record.type === 'nda') counts.nda++;
                else if (record.type === 'mou') counts.mou++;
                else if (record.type === 'invoice') counts.invoice++;
            });
            setUsage(counts);
        } catch (err) {
            console.warn('Error refreshing usage:', err);
        }
    };

    return {
        trialDaysLeft,
        isTrialExpired,
        isPremium,
        usage,
        limits: TRIAL_LIMITS,
        canCreate,
        refreshUsage,
        loading,
        trialStartDate
    };
}
