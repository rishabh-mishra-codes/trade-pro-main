import { memo, useEffect, useState } from "react";
import { getQuotesFor, INDIAN_STOCKS } from "../services/indianStockService";

// A thin marquee row of live NSE quotes that scrolls across the top of the app.
// Polls every ~15s and degrades gracefully: on a failed fetch it keeps the last
// known data (or renders nothing) rather than crashing the shell.
function TopTicker() {
    const [quotes, setQuotes] = useState([]);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                const q = await getQuotesFor(INDIAN_STOCKS);
                if (mounted) setQuotes(q);
            } catch {
                /* keep last data; never crash */
            }
        };

        load();
        const timer = setInterval(load, 15000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, []);

    if (!quotes.length) return null;

    // Duplicate the list so the -50% scroll produces a seamless loop.
    const items = [...quotes, ...quotes];

    return (
        <div className="surface border-b border-white/10 overflow-hidden">
            <div className="ticker-track py-2">
                {items.map((s, i) => (
                    <span
                        key={`${s.symbol}-${i}`}
                        className="flex items-center gap-2 px-6 whitespace-nowrap text-sm"
                    >
                        <span className="font-semibold">{s.symbol}</span>
                        <span className="text-muted">₹{s.price}</span>
                        <span
                            className={s.positive ? "text-emerald-400" : "text-red-400"}
                        >
                            {s.percentage}
                        </span>
                    </span>
                ))}
            </div>
        </div>
    );
}

export default memo(TopTicker);
