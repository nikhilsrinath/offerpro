import { stampGeometry } from '../utils/imageUtils';

/**
 * The circular company stamp, drawn as real SVG elements.
 *
 * This used to be `dangerouslySetInnerHTML` over a string built from the company
 * name and city. Geometry now comes from stampGeometry() and React creates the
 * nodes, so the text is a text node by construction and there is no markup for a
 * name containing `<` or a quote to break out of. The PNG path in imageUtils
 * still builds a string — rasterising needs a standalone document — and shares
 * the same geometry, so the two renderings stay identical.
 */
export default function StampPreview({ companyName, city, size = 120 }) {
  const g = stampGeometry(companyName || 'COMPANY', city || '', size);

  return (
    <div className="stamp-svg">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={g.size}
        height={g.size}
        viewBox={`0 0 ${g.size} ${g.size}`}
      >
        <circle cx={g.cx} cy={g.cy} r={g.outerR} fill="none" stroke={g.color} strokeWidth={g.outerStroke} />
        <circle cx={g.cx} cy={g.cy} r={g.innerR} fill="none" stroke={g.color} strokeWidth={g.innerStroke} />

        {g.dots.map((d, i) => (
          <circle key={`dot-${i}`} cx={d.cx} cy={d.cy} r={d.r} fill={g.color} />
        ))}

        {g.chars.map((c, i) => (
          <text
            key={`ch-${i}`}
            x={c.x}
            y={c.y}
            fontFamily="Arial, sans-serif"
            fontSize={c.fontSize}
            fontWeight={c.bold ? 'bold' : undefined}
            fill={g.color}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(${c.rot}, ${c.x}, ${c.y})`}
          >
            {c.ch}
          </text>
        ))}

        <rect
          x={g.badge.x}
          y={g.badge.y}
          width={g.badge.width}
          height={g.badge.height}
          rx={g.badge.rx}
          fill={g.color}
        />
        <text
          x={g.cx}
          y={g.cy}
          fontFamily="Arial, sans-serif"
          fontSize={g.badge.fontSize}
          fontWeight="bold"
          fill="white"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {g.initial}
        </text>
      </svg>
    </div>
  );
}
