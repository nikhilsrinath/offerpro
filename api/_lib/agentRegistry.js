import { AGENT_ID as DEADLINE_AGENT, normalizeConfig as deadlineConfig } from '../../src/shared/deadlineWatch.js';
import { AGENT_ID as OPS_AGENT, AGENT_NAME as OPS_NAME } from '../../src/shared/opsMonitor.js';
import { AGENT_ID as DEAL_AGENT, AGENT_NAME as DEAL_NAME } from '../../src/shared/dealIntel.js';
import { AGENT_ID as BI_AGENT, AGENT_NAME as BI_NAME } from '../../src/shared/bizIntel.js';
import { readSettings, saveSettings, runForOrg, runScheduled } from './deadlines.js';
import { readSettings as readOps, saveSettings as saveOps, runOpsForOrg, runOpsScheduled } from './operations.js';
import { readDealSettings, saveDealSettings, runDealsForOrg, runDealsScheduled } from './deals.js';
import { readBizSettings, saveBizSettings, runBizForOrg, runBizScheduled } from './bizIntel.js';

/**
 * Every agent that runs on the server on its own, by id: how to read and
 * save its settings, run it for one org now, and run its scheduled sweep.
 * /api/agents uses this for the cards' switch (automation status / set) and
 * for the per-agent cron (GET ?agent=<id>, vercel.json).
 *
 * Internal Knowledge has no automatic mode yet (it needs document end and
 * review dates); the cards show it as coming soon.
 */
export const SERVER_AGENTS = {
  [DEADLINE_AGENT]: {
    name: 'Compliance and Deadline Agent',
    read: (admin, orgId) => readSettings(admin, orgId, DEADLINE_AGENT, deadlineConfig),
    save: saveSettings,
    runOne: runForOrg,
    runScheduled,
  },
  [OPS_AGENT]: { name: OPS_NAME, read: readOps, save: saveOps, runOne: runOpsForOrg, runScheduled: runOpsScheduled },
  [DEAL_AGENT]: { name: DEAL_NAME, read: readDealSettings, save: saveDealSettings, runOne: runDealsForOrg, runScheduled: runDealsScheduled },
  [BI_AGENT]: { name: BI_NAME, read: readBizSettings, save: saveBizSettings, runOne: runBizForOrg, runScheduled: runBizScheduled },
};

export const COMING_SOON = ['internal_knowledge'];
