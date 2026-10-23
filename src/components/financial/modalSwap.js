import { createContext } from 'react';

/**
 * True while one side panel replaces another in place (Record Money's Type
 * switch): the new panel appears where the old one was, without sliding and
 * fading in again as if it had been closed and reopened.
 */
export const ModalSwap = createContext(false);
