import { createContext, useContext } from 'react';

/* The context object and its hook, apart from the provider component so the
   provider file exports only a component (fast refresh). */

export const AssistantCtx = createContext(null);

export function useAssistant() {
    const v = useContext(AssistantCtx);
    if (!v) throw new Error('useAssistant must be used inside <AssistantProvider>');
    return v;
}
