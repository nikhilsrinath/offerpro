import { useState, useEffect } from 'react';

/**
 * ISO 3166-1 country picker.
 *
 * The list lives in the generated world-map module, which is ~150KB and has no
 * business in the main bundle just so a form can offer a dropdown — so it is
 * imported on mount and the control renders as a plain disabled input until it
 * arrives. ALL_COUNTRIES is the full ISO list rather than only the countries
 * the map can draw: a customer in Singapore has to be selectable even though
 * the 110m map has no polygon for it.
 */
export default function CountrySelect({
  value,
  onChange,
  id,
  placeholder = 'Infer from state / organisation',
}) {
  const [countries, setCountries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    import('../../data/worldMap.js')
      .then((m) => { if (!cancelled) setCountries(m.ALL_COUNTRIES); })
      .catch(() => { if (!cancelled) setCountries([]); });
    return () => { cancelled = true; };
  }, []);

  if (!countries) {
    return <input id={id} className="easy-inp" value="Loading..." disabled readOnly />;
  }

  return (
    <select
      id={id}
      className="easy-inp"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {countries.map(([code, name]) => (
        <option key={code} value={code}>{name}</option>
      ))}
    </select>
  );
}
