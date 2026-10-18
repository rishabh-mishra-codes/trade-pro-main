// Pure SVG portfolio-allocation donut — no charting library, no new deps.
// Each holding becomes one arc segment on a single circle, sized by its
// `percent` share of 100 via stroke-dasharray, with the offset accumulated
// across segments so they lay end to end. The SVG is rotated -90deg so the
// first segment starts at the top (12 o'clock).
//
// `fmt` is replicated here (not imported) because PortfolioAnalysis keeps its
// own local, non-exported fmt; duplicating the tiny en-IN formatter keeps this
// component self-contained so task 12.2 only needs to pass `allocation`.
const fmt = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
// Distinct saturated hues so each segment (and its legend swatch) reads as a
// separate color instead of blending into the blue accent token.
const PALETTE = [
    "#22c55e",
    "#eab308",
    "#f97316",
    "#ef4444",
    "#14b8a6",
    "#a855f7",
    "#3b82f6",
    "#ec4899",
];
export default function AllocationDonut({ allocation }) {
    // Guard: parent gates on hasHoldings, but render nothing if empty/undefined.
    if (!Array.isArray(allocation) || allocation.length === 0) return null;
    const R = 60;
    const C = 2 * Math.PI * R;
    const stroke = 24;
    let offset = 0;
    return (
        <div className="flex flex-wrap items-center gap-6">
            <svg viewBox="0 0 160 160" className="w-40 h-40 -rotate-90">
                {allocation.map((a, i) => {
                    const len = (a.percent / 100) * C;
                    const seg = (
                        <circle
                            key={a.symbol}
                            cx="80"
                            cy="80"
                            r={R}
                            fill="none"
                            stroke={PALETTE[i % PALETTE.length]}
                            strokeWidth={stroke}
                            strokeDasharray={`${len} ${C - len}`}
                            strokeDashoffset={-offset}
                        />
                    );
                    offset += len;
                    return seg;
                })}
            </svg>
            <ul className="space-y-1 text-sm">
                {allocation.map((a, i) => (
                    <li key={a.symbol} className="flex items-center gap-2">
                        <span
                            className="h-3 w-3 rounded-sm shrink-0"
                            style={{ background: PALETTE[i % PALETTE.length] }}
                        />
                        <span className="font-medium">{a.symbol}</span>
                        <span className="text-muted">
                            {a.percent.toFixed(1)}% · ₹{fmt(a.currentValue)}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
