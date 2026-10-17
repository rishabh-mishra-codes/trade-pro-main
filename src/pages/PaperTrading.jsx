import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaFlask, FaPlus, FaRedo } from "react-icons/fa";

import { getQuotesFor, INDIAN_STOCKS } from "../services/indianStockService";
import authService from "../services/authService";
import { getAvatar } from "../services/profileService";
import {
    readPaper,
    buyPaper,
    sellPaper,
    resetPaper,
    setStopLoss,
    clearStopLoss,
    computePaperMetrics,
} from "../services/paperTradingService";

import NavBar from "../components/NavBar";
import TradeModal from "../components/TradeModal";

const fmt = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

// A small default universe to trade from in paper mode.
const PAPER_UNIVERSE = INDIAN_STOCKS;

function PaperTrading() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const [paper, setPaper] = useState({ wallet: 0, holdings: {} });
    const [quotes, setQuotes] = useState([]); // enriched quotes for the universe + holdings
    const [tradeModal, setTradeModal] = useState({ open: false, mode: "buy", stock: null });
    const [toast, setToast] = useState("");

    const paperRef = useRef(paper);
    paperRef.current = paper;

    const showToast = useCallback((msg) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    }, []);

    // Initial load: user + the local paper portfolio (no backend call).
    useEffect(() => {
        const load = async () => {
            try {
                const current = await authService.getCurrentUser();
                setUser({ ...current, avatarUrl: getAvatar(current.$id) });
                setPaper(readPaper());
            } catch {
                navigate("/");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [navigate]);

    // Poll live prices for the universe plus any held symbols every 15s, then
    // auto-sell any paper holding whose live price <= its stop-loss.
    useEffect(() => {
        let mounted = true;

        const poll = async () => {
            const held = paperRef.current.holdings || {};
            const universeSymbols = new Set(PAPER_UNIVERSE.map((s) => s.symbol));
            const extra = Object.values(held)
                .filter((h) => !universeSymbols.has(h.symbol))
                .map((h) => ({ symbol: h.symbol, name: h.name }));
            const stocks = [...PAPER_UNIVERSE, ...extra];

            try {
                const q = await getQuotesFor(stocks);
                if (!mounted) return;
                setQuotes(q);

                // Client-side paper stop-loss: sell at the live price when hit.
                const priceBySymbol = new Map(q.map((s) => [s.symbol, s.rawPrice]));
                let changed = false;
                Object.values(paperRef.current.holdings || {}).forEach((h) => {
                    const last = priceBySymbol.get(h.symbol);
                    if (h.stopLoss && last != null && last <= h.stopLoss && h.qty > 0) {
                        try {
                            sellPaper({ symbol: h.symbol, price: last, qty: h.qty });
                            changed = true;
                            showToast(
                                `PAPER stop-loss hit: sold ${h.qty} ${h.symbol} at ₹${fmt(last)}`
                            );
                        } catch {
                            /* ignore per-holding failure */
                        }
                    }
                });
                if (changed) setPaper(readPaper());
            } catch {
                /* graceful degrade: keep last known quotes */
            }
        };

        poll();
        const timer = setInterval(poll, 15000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [showToast]);

    const livePrices = useMemo(() => {
        const map = new Map();
        quotes.forEach((s) => map.set(s.symbol, s.rawPrice));
        return map;
    }, [quotes]);

    const metrics = useMemo(
        () => computePaperMetrics(paper, livePrices),
        [paper, livePrices]
    );

    const openTrade = useCallback(
        (mode, stock) => setTradeModal({ open: true, mode, stock }),
        []
    );

    const confirmTrade = useCallback(
        ({ symbol, name, price, qty }) => {
            try {
                if (tradeModal.mode === "buy") {
                    buyPaper({ symbol, name, price, qty });
                    showToast(`PAPER: bought ${qty} ${name}`);
                } else {
                    sellPaper({ symbol, price, qty });
                    showToast(`PAPER: sold ${qty} ${name}`);
                }
                setPaper(readPaper());
                setTradeModal({ open: false, mode: "buy", stock: null });
            } catch (err) {
                showToast(err.message);
            }
        },
        [tradeModal.mode, showToast]
    );

    const handleStopLoss = useCallback(
        (symbol, currentStop) => {
            const input = window.prompt(
                `PAPER stop-loss for ${symbol} (₹). Leave blank to clear.`,
                currentStop ? String(currentStop) : ""
            );
            if (input === null) return;
            const trimmed = input.trim();
            if (trimmed === "") {
                clearStopLoss(symbol);
                showToast(`PAPER stop-loss cleared for ${symbol}`);
            } else {
                const value = Number(trimmed);
                if (!Number.isFinite(value) || value <= 0) {
                    showToast("Enter a valid stop price");
                    return;
                }
                setStopLoss(symbol, value);
                showToast(`PAPER stop-loss set for ${symbol} at ₹${fmt(value)}`);
            }
            setPaper(readPaper());
        },
        [showToast]
    );

    const handleReset = useCallback(() => {
        if (!window.confirm("Reset the paper portfolio to ₹100,000?")) return;
        resetPaper();
        setPaper(readPaper());
        showToast("Paper portfolio reset");
    }, [showToast]);

    const logout = useCallback(async () => {
        await authService.logout();
        navigate("/");
    }, [navigate]);

    if (loading) {
        return (
            <div className="min-h-screen app-bg flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const ownedQty = tradeModal.stock
        ? paper.holdings[tradeModal.stock.symbol]?.qty || 0
        : 0;

    return (
        <div className="min-h-screen app-bg">
            <NavBar user={user} onLogout={logout} live />

            <main className="max-w-7xl mx-auto px-6 py-8">
                <button
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-2 text-muted hover:text-current mb-6"
                >
                    <FaArrowLeft /> Back to dashboard
                </button>

                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FaFlask className="text-amber-400" /> Paper Trading
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">
                            PAPER / VIRTUAL
                        </span>
                    </h1>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 text-sm text-muted hover:text-current"
                    >
                        <FaRedo size={12} /> Reset
                    </button>
                </div>

                <p className="text-sm text-muted mb-6">
                    Practice with virtual cash at live prices. Nothing here affects your real
                    wallet, holdings, or orders.
                </p>

                {/* Summary */}
                <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <SummaryCard label="Virtual Cash" value={`₹${fmt(paper.wallet)}`} />
                    <SummaryCard label="Holdings Value" value={`₹${fmt(metrics.holdingsValue)}`} />
                    <SummaryCard
                        label="Total P&L"
                        value={`${metrics.totalPnl >= 0 ? "+" : "-"}₹${fmt(Math.abs(metrics.totalPnl))}`}
                        sub={`${metrics.totalPnlPercent >= 0 ? "+" : ""}${metrics.totalPnlPercent.toFixed(2)}%`}
                        valueClass={metrics.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
                    />
                    <SummaryCard label="Total Value" value={`₹${fmt(metrics.totalValue)}`} />
                </section>

                {/* Buy from universe */}
                <section className="mt-10">
                    <h2 className="text-lg font-bold mb-3">Trade (virtual)</h2>
                    <div className="surface rounded-2xl overflow-hidden">
                        {quotes.length === 0 ? (
                            <p className="p-5 text-muted text-sm">Loading quotes...</p>
                        ) : (
                            PAPER_UNIVERSE.map((stock) => {
                                const q = quotes.find((x) => x.symbol === stock.symbol);
                                return (
                                    <div
                                        key={stock.symbol}
                                        className="flex items-center justify-between p-4 border-b border-white/5 last:border-0"
                                    >
                                        <div>
                                            <p className="font-semibold text-sm">{stock.name}</p>
                                            <p className="text-xs text-muted">{stock.symbol}</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <p className="font-semibold text-sm">
                                                    ₹{q ? q.price : "--"}
                                                </p>
                                                {q && (
                                                    <p
                                                        className={`text-xs ${
                                                            q.positive ? "text-emerald-400" : "text-red-400"
                                                        }`}
                                                    >
                                                        {q.percentage}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={() =>
                                                    openTrade("buy", {
                                                        symbol: stock.symbol,
                                                        name: stock.name,
                                                        rawPrice: q ? q.rawPrice : 0,
                                                    })
                                                }
                                                className="px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs flex items-center gap-1"
                                            >
                                                <FaPlus size={10} /> Buy
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>

                {/* Paper holdings */}
                <section className="mt-10 pb-12">
                    <h2 className="text-lg font-bold mb-3">Paper Holdings</h2>
                    <div className="surface rounded-2xl overflow-hidden">
                        {metrics.holdings.length === 0 ? (
                            <p className="p-6 text-muted text-sm text-center">
                                No paper holdings yet. Buy something above to get started.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-muted text-xs border-b border-white/10">
                                        <tr>
                                            <th className="text-left p-4">Stock</th>
                                            <th className="text-right p-4">Qty</th>
                                            <th className="text-right p-4">Avg</th>
                                            <th className="text-right p-4">LTP</th>
                                            <th className="text-right p-4">Value</th>
                                            <th className="text-right p-4">P&L</th>
                                            <th className="text-right p-4">Stop</th>
                                            <th className="text-right p-4">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {metrics.holdings.map((h) => (
                                            <tr key={h.symbol} className="border-b border-white/5">
                                                <td className="p-4">
                                                    <p className="font-semibold">{h.name}</p>
                                                    <p className="text-xs text-muted">{h.symbol}</p>
                                                </td>
                                                <td className="text-right p-4">{h.qty}</td>
                                                <td className="text-right p-4">₹{fmt(h.avgPrice)}</td>
                                                <td className="text-right p-4">₹{fmt(h.last)}</td>
                                                <td className="text-right p-4">₹{fmt(h.marketValue)}</td>
                                                <td
                                                    className={`text-right p-4 ${
                                                        h.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                                                    }`}
                                                >
                                                    {h.pnl >= 0 ? "+" : "-"}₹{fmt(Math.abs(h.pnl))}
                                                    <span className="block text-xs">
                                                        {h.pnlPercent >= 0 ? "+" : ""}
                                                        {h.pnlPercent.toFixed(2)}%
                                                    </span>
                                                </td>
                                                <td className="text-right p-4">
                                                    <button
                                                        onClick={() => handleStopLoss(h.symbol, h.stopLoss)}
                                                        className="text-xs text-indigo-400 hover:text-indigo-300"
                                                        title="Set/clear paper stop-loss"
                                                    >
                                                        {h.stopLoss ? `₹${fmt(h.stopLoss)}` : "Set SL"}
                                                    </button>
                                                </td>
                                                <td className="text-right p-4">
                                                    <button
                                                        onClick={() =>
                                                            openTrade("sell", {
                                                                symbol: h.symbol,
                                                                name: h.name,
                                                                rawPrice: h.last,
                                                            })
                                                        }
                                                        className="px-3 py-1 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs"
                                                    >
                                                        Sell
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </section>
            </main>

            <TradeModal
                open={tradeModal.open}
                mode={tradeModal.mode}
                stock={tradeModal.stock}
                wallet={paper.wallet}
                ownedQty={ownedQty}
                onClose={() => setTradeModal({ open: false, mode: "buy", stock: null })}
                onConfirm={confirmTrade}
            />

            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-200 surface px-5 py-3 rounded-xl shadow-2xl text-sm font-medium">
                    {toast}
                </div>
            )}
        </div>
    );
}

const SummaryCard = memo(function SummaryCard({ label, value, sub, valueClass }) {
    return (
        <div className="surface card-hover rounded-2xl p-5">
            <p className="text-sm text-muted font-medium">{label}</p>
            <p className={`text-2xl font-extrabold mt-3 tracking-tight ${valueClass || ""}`}>
                {value}
            </p>
            {sub && <p className={`text-sm mt-0.5 ${valueClass || "text-muted"}`}>{sub}</p>}
        </div>
    );
});

export default PaperTrading;
