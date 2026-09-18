import { useMemo } from 'react';
import { useOrg } from '../context/OrgContext';
import { missingProfileEssentials, profileGapSummary } from '../lib/profileCompletion';

/**
 * The state behind the red dot in the top bar. Reads the active organization,
 * so it clears itself the moment the profile is saved — there is nothing to
 * dismiss and nothing stored per user.
 */
export function useProfileCompletion() {
  const { activeOrg } = useOrg();

  return useMemo(() => {
    const missing = missingProfileEssentials(activeOrg);
    return {
      missing,
      // No org yet (still hydrating) is not an incomplete org: showing the dot
      // then would flash it on every load for a fully configured workspace.
      incomplete: !!activeOrg && missing.length > 0,
      summary: profileGapSummary(missing),
      next: missing[0] || null,
    };
  }, [activeOrg]);
}

export default useProfileCompletion;
