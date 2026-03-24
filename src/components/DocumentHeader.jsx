export default function DocumentHeader({ formData }) {
  const name = formData.companyName || formData.disclosingPartyName || formData.firstPartyName || '';
  const tagline = formData.companyTagline || '';
  const cin = formData.cin || '';
  const address = formData.companyAddress || formData.disclosingPartyAddress || formData.firstPartyAddress || '';
  const phone = formData.contactPhone || formData.companyPhone || '';
  const email = formData.contactEmail || formData.companyEmail || '';
  const website = formData.companyWebsite || '';
  const logo = formData.companyLogo || '';

  return (
    <div className="doc-header">
      <div className="doc-header-left">
        {logo && <img src={logo} alt="Logo" className="doc-header-logo" />}
        {tagline && <div className="doc-header-tagline">{tagline}</div>}
      </div>
      <div className="doc-header-right">
        <div className="doc-header-name">{name.toUpperCase()}</div>
        {cin && <div className="doc-header-detail">CIN: {cin}</div>}
        {address && <div className="doc-header-detail">{address}</div>}
        {phone && <div className="doc-header-detail">{phone}</div>}
        {email && <div className="doc-header-detail">{email}</div>}
        {website && <div className="doc-header-detail">{website}</div>}
      </div>
    </div>
  );
}
