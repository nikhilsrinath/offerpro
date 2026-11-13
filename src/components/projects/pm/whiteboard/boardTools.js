import {
    MousePointer2, Hand, StickyNote, Type, Square, ArrowUpRight, Pencil,
} from 'lucide-react';

/** The whiteboard's tools, down the left side, with their keyboard shortcuts. */
export const TOOLS = [
    { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
    { id: 'hand', label: 'Move the board', key: 'H', Icon: Hand },
    { id: 'sticky', label: 'Sticky note', key: 'N', Icon: StickyNote },
    { id: 'text', label: 'Text', key: 'T', Icon: Type },
    { id: 'shape', label: 'Shape', key: 'S', Icon: Square },
    { id: 'arrow', label: 'Arrow', key: 'L', Icon: ArrowUpRight },
    { id: 'pen', label: 'Pen', key: 'P', Icon: Pencil },
];
