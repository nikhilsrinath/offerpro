import { createContext } from 'react';

/* The element inside ModuleShell's rail that a page may render its own
   navigation into (via a portal), for pages whose sections are the menu. */
export const RailSlotContext = createContext(null);
