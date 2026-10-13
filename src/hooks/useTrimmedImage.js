import { useEffect, useState } from 'react';
import { trimImage } from '../utils/imageUtils';

/**
 * An image with its empty margins cut away (utils/imageUtils trimImage), for
 * a signature that was signed small in a large pad and would otherwise be
 * drawn as a speck. Shows the image as it is until the trimmed copy is ready,
 * and keeps it that way if it cannot be read.
 */
export function useTrimmedImage(src) {
    const [done, setDone] = useState({ src: null, out: null });
    useEffect(() => {
        if (!src) return undefined;
        let alive = true;
        trimImage(src).then((out) => { if (alive) setDone({ src, out }); }).catch(() => {});
        return () => { alive = false; };
    }, [src]);
    if (!src) return null;
    return done.src === src && done.out ? done.out : src;
}
