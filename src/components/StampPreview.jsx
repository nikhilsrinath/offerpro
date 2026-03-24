import { buildStampSvg } from '../utils/imageUtils';

export default function StampPreview({ companyName, city, size = 120 }) {
  const svgString = buildStampSvg(companyName || 'COMPANY', city || '', size);

  return (
    <div
      className="stamp-svg"
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}
