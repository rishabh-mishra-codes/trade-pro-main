import { memo } from "react";
import { FaTrash } from "react-icons/fa";

// "1 stock" / "2 stocks" — correct singular/plural wording for a count.
// Mirrors the helper in Home.jsx so this section's header pluralizes correctly.
const pluralize = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A single saved-symbol row. Renders for EVERY saved symbol — including ones
// with no available quote — showing a live quote when present and a loading /
// unavailable placeholder otherwise, so a saved stock never disappears.
//
// Remove control visibility: shown at opacity-60 on touch/small screens (no
// hover to rely on) and hidden until hover from `sm:` up — i.e. remove stays
// touch-visible as the design requires.
const WatchRow = memo(function WatchRow({
    symbol,
    name,
    quote,
    marketStatus,
    selected,
    onSelect,
    onRemove,
}) {
    // A quote with a real (non-zero) price is resolved; otherwise the price is
    // either still loading or genuinely unavailable (Yahoo returned nothing).
    const hasPrice = quote && Number(quote.rawPrice) > 0;
    const loadingPrice = !quote && marketStatus === "loading";

    return (
        <div
            className={`group flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/5 transition ${
                selected ? "bg-white/5" : ""
            }`}
        >
            <button onClick={() => onSelect(symbol)} className="flex-1 text-left">
                <p className="font-semibold text-sm">{name}</p>
                <p className="text-xs text-muted">{symbol}</p>
            </button>
            <div className="flex items-center gap-3">
                <div className="text-right">
                    {hasPrice ? (
                        <>
                            <p className="font-semibold text-sm">₹{quote.price}</p>
                            <p
                                className={`text-xs ${
                                    quote.positive ? "text-emerald-400" : "text-red-400"
                                }`}
                            >
                                {quote.percentage}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="font-semibold text-sm text-muted">
                                {loadingPrice ? "…" : "—"}
                            </p>
                            <p className="text-xs text-muted">
                                {loadingPrice ? "loading" : "unavailable"}
                            </p>
                        </>
                    )}
                </div>
                <button
                    onClick={() => onRemove(symbol)}
                    className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition"
                    title="Remove"
                >
                    <FaTrash size={11} />
                </button>
            </div>
        </div>
    );
});

// Dedicated, distinctly-delineated watchlist panel (R5.1). Presentational only:
// all state and handlers are owned by Home.jsx and passed in as props.
// Renders one WatchRow per SAVED symbol — quote or not (R5.2, R5.5).
const WatchlistSection = memo(function WatchlistSection({
    watchStocks,
    quoteBySymbol,
    marketStatus,
    selectedSymbol,
    onSelect,
    onRemove,
}) {
    return (
        <div className="surface rounded-2xl overflow-hidden">
            {/* Panel header: title + saved-symbol count, delineating this as its
                own section separate from the chart and holdings. */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 className="text-lg font-bold">Watchlist</h2>
                <span className="text-xs text-muted">
                    {pluralize(watchStocks.length, "stock")}
                </span>
            </div>

            {/* Render one row per SAVED symbol so a saved stock never disappears
                when its quote is slow or unavailable. The empty-state shows only
                when the saved list is truly empty. */}
            {watchStocks.length === 0 ? (
                <p className="p-5 text-muted text-sm">Search above to add stocks.</p>
            ) : (
                watchStocks.map((saved) => {
                    const quote = quoteBySymbol.get(saved.symbol);
                    return (
                        <WatchRow
                            key={saved.symbol}
                            symbol={saved.symbol}
                            name={quote?.name || saved.name}
                            quote={quote}
                            marketStatus={marketStatus}
                            selected={selectedSymbol === saved.symbol}
                            onSelect={onSelect}
                            onRemove={onRemove}
                        />
                    );
                })
            )}
        </div>
    );
});

export default WatchlistSection;
