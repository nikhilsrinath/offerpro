import React from 'react';

/* Apollo's "when to fill in company details" choice on its Connectors panel. */
export default function AutoFillChoice({ value, onChange, disabled }) {
    const opt = (v, title, text) => (
        <label className={`cn-choice${value === v ? ' is-on' : ''}`}>
            <input type="radio" name="apollo-auto" checked={value === v} disabled={disabled} onChange={() => onChange(v)} />
            <span>
                <span className="cn-choice-title">{title}</span>
                <span className="cn-choice-text">{text}</span>
            </span>
        </label>
    );
    return (
        <div className="cn-choices" role="radiogroup" aria-label="When Apollo fills in company details">
            {opt(false, 'Only When Someone Asks', 'People click Fill From Apollo or Look Up. Best for controlling credits.')}
            {opt(true, 'Automatically for New Clients and Leads', 'Each new client or lead with a website or business email is looked up once, using 1 credit.')}
        </div>
    );
}
