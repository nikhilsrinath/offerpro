import React from 'react';
import { DashStyle } from '../overview/dashKit';
import { useOverviewModel } from '../overview/useOverviewModel';
import { TipProvider } from '../overview/vizKit';
import { useViz } from '../overview/vizHooks';
import Drilldown from '../overview/Drilldown';

/* The Dashboard's drill-down sheet, opened from a hub widget. Mounted only
   while a sheet is open, so the hub does not build the overview model until
   someone asks for the analysis behind a widget. */

const PERIOD = '30D';

export default function WidgetDrill({ stack, push, pop, close }) {
    const { t } = useViz();
    const model = useOverviewModel(PERIOD);
    const resolved = stack.map((v) => (typeof v === 'function' ? v(model) : v));
    return (
        <TipProvider>
            <div className="ov-page">
                <Drilldown model={model} stack={resolved} push={push} pop={pop} close={close} />
                <DashStyle t={t} />
            </div>
        </TipProvider>
    );
}
