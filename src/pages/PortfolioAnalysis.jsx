import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaArrowUp, FaArrowDown } from "react-icons/fa";
import authService from "../services/authService";
import { fetchPortfolio } from "../services/portfolioService";
import { getOrders } from "../services/orderService";
import { getQuotesFor } from "../services/indianStockService";
import { getAvatar } from "../services/profileService";
import NavBar from "../components/NavBar";
import AllocationDonut from "../components/AllocationDonut";
const fmt = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
const signed = (v) => `${v >= 0 ? "+" : "-"}₹${fmt(Math.abs(v))}`;
// Same distinct hues as AllocationDonut so the horizontal allocation bars
// visually match the donut segments (index-aligned per allocation row).
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
// Realized P&L from executed orders. Orders arrive createdAt-desc, so we
// reverse to oldest->newest and replay each symbol's position, booking a gain
// on every SELL against the running average cost.
function computeRealized(orders) {
    const executed = (Array.isArray(orders) ? orders : [])
        .filter((o) => o.status === "EXECUTED")
        .slice()
        .reverse();
    const positions = {}; // symbol -> { qty, avgCost }
    let realized = 0;
    let sellCount = 0;
    executed.forEach((o) => {
        const sym = o.symbol;
        const qty = Number(o.quantity) || 0;
        const price = Number(o.price) || 0;
        const pos = positions[sym] || { qty: 0, avgCost: 0 };
        if (o.side === "BUY") {
            const totalQty = pos.qty + qty;
            pos.avgCost = totalQty
                ? (pos.avgCost * pos.qty + price * qty) / totalQty
                : 0;
            pos.qty = totalQty;
        } else if (o.side === "SELL") {
            sellCount += 1;
            const soldQty = Math.min(qty, pos.qty);
            realized += (price - pos.avgCost) * soldQty;
            pos.qty -= soldQty;
            if (pos.qty <= 0) {
                pos.qty = 0;
                pos.avgCost = 0;
            }
        }
        positions[sym] = pos;
    });
    return { realized, hasSells: sellCount > 0 };
}
function PortfolioAnalysis() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [portfolio, setPortfolio] = useState({ wallet: 0, holdings: {} });
    const [orders, setOrders] = useState([]);
    const [livePrices, setLivePrices] = useState(new Map());
    const [pricesLoaded, setPricesLoaded] = useState(false);
    const [quotesFailed, setQuotesFailed] = useState(false);
    // Holding symbols to quote, kept in a ref so the 15s poll reads the latest
    // list without re-creating the interval.
    const portfolioRef = useRef(portfolio);
    portfolioRef.current = portfolio;
    // Initial load: user + portfolio + orders.
    useEffect(() => {
        const init = async () => {
            try {
                const u = await authService.getCurrentUser();
                setUser({ ...u, avatarUrl: getAvatar(u.$id) });
                const [pf, ord] = await Promise.all([
                    fetchPortfolio(),
                    getOrders().catch(() => []),
                ]);
                setPortfolio(pf);
                setOrders(ord || []);
            } catch {
                navigate("/");
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [navigate]);
    // Poll live prices for the holding symbols every 15s.
    useEffect(() => {
        let mounted = true;
        const loadQuotes = async () => {
            const held = Object.values(portfolioRef.current.holdings || {});
            if (!held.length) return;
            const stocks = held.map((h) => ({ symbol: h.symbol, name: h.name }));
            try {
                const quotes = await getQuotesFor(stocks);
                if (!mounted) return;
                const map = new Map();
                quotes.forEach((q) => map.set(q.symbol, q.rawPrice));
                setLivePrices(map);
                setPricesLoaded(map.size > 0);
                setQuotesFailed(false);
            } catch {
                if (mounted) setQuotesFailed(true);
            }
        };
        loadQuotes();
        const timer = setInterval(loadQuotes, 15000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, []);
    const logout = useCallback(async () => {
        await authService.logout();
        navigate("/");
    }, [navigate]);
    // Per-holding + aggregate metrics against live prices.
    const analysis = useMemo(() => {
        const rows = Object.values(portfolio.holdings || {}).map((h) => {
            const last = livePrices.get(h.symbol) ?? h.avgPrice;
            const currentValue = last * h.qty;
            const invested = h.avgPrice * h.qty;
            const pnl = currentValue - invested;
            return {
                ...h,
                last,
                currentValue,
                invested,
                pnl,
                pnlPercent: invested ? (pnl / invested) * 100 : 0,
            };
        });
        const currentTotal = rows.reduce((s, r) => s + r.currentValue, 0);
        const investedTotal = rows.reduce((s, r) => s + r.invested, 0);
        const unrealized = currentTotal - investedTotal;
        const allocation = rows
            .map((r) => ({
                symbol: r.symbol,
                name: r.name,
                currentValue: r.currentValue,
                percent: currentTotal ? (r.currentValue / currentTotal) * 100 : 0,
            }))
            .sort((a, b) => b.currentValue - a.currentValue);
        // Best/worst only make sense once a holding has a real live price.
        // Before the first quote resolves every pnl is 0 (last falls back to
        // avgPrice), so restrict the selection to symbols actually present in
        // livePrices and leave best/worst null when none qualify yet.
        let best = null;
        let worst = null;
        rows.forEach((r) => {
            if (!livePrices.has(r.symbol)) return;
            if (!best || r.pnlPercent > best.pnlPercent) best = r;
            if (!worst || r.pnlPercent < worst.pnlPercent) worst = r;
        });
        return {
            rows,
            currentTotal,
            investedTotal,
            unrealized,
            unrealizedPercent: investedTotal ? (unrealized / investedTotal) * 100 : 0,
            allocation,
            best,
            worst,
        };
    }, [portfolio, livePrices]);
    const { realized, hasSells } = useMemo(
        () => computeRealized(orders),
        [orders]
    );
    if (loading) {
        return (
            <div className="min-h-screen app-bg flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }
    const hasHoldings = analysis.rows.length > 0;
    return (
        <div className="min-h-screen app-bg">
            <NavBar user={user} onLogout={logout} live />
            <main className="max-w-6xl mx-auto px-6 py-8">
                <button
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-2 text-muted hover:text-current mb-6"
                >
                    <FaArrowLeft /> Back to dashboard
                </button>
                <h1 className="text-2xl font-bold mb-1">Portfolio Analysis</h1>
                <p className="text-sm text-muted mb-6">
                    Live breakdown of allocation, returns and realized gains.
                </p>
                {quotesFailed && (
                    <p className="mb-4 text-sm text-red-400">
                        Couldn&apos;t refresh live prices; showing last known values.
                    </p>
                )}
                {!hasHoldings ? (
                    <div className="surface rounded-2xl p-8 text-center text-muted text-sm">
                        No holdings yet. Buy a stock from the dashboard to see your
                        portfolio analysis.
                    </div>
                ) : (
                    <>
                        {/* Summary cards */}
                        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <StatCard
                                label="Invested"
                                value={`₹${fmt(analysis.investedTotal)}`}
                            />
                            <StatCard
                                label="Current Value"
                                value={`₹${fmt(analysis.currentTotal)}`}
                            />
                            <StatCard
                                label="Unrealized P&L"
                                value={signed(analysis.unrealized)}
                                sub={`${analysis.unrealizedPercent >= 0 ? "+" : ""}${analysis.unrealizedPercent.toFixed(2)}%`}
                                valueClass={
                                    analysis.unrealized >= 0
                                        ? "text-emerald-400"
                                        : "text-red-400"
                                }
                            />
                            <StatCard
                                label="Realized P&L"
                                value={hasSells ? signed(realized) : "--"}
                                sub={
                                    hasSells
                                        ? undefined
                                        : "Needs a completed sell"
                                }
                                valueClass={
                                    hasSells
                                        ? realized >= 0
                                            ? "text-emerald-400"
                                            : "text-red-400"
                                        : ""
                                }
                            />
                        </section>
                        {/* Best / worst */}
                        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <MoverCard
                                title="Best Performer"
                                holding={analysis.best}
                                pricesLoaded={pricesLoaded}
                                positive
                            />
                            <MoverCard
                                title="Worst Performer"
                                holding={analysis.worst}
                                pricesLoaded={pricesLoaded}
                            />
                        </section>
                        {/* Allocation donut */}
                        <section className="mt-8">
                            <h2 className="text-lg font-bold mb-3">
                                Allocation Breakdown
                            </h2>
                            <div className="surface rounded-2xl p-5">
                                <AllocationDonut allocation={analysis.allocation} />
                            </div>
                        </section>
                        {/* Allocation bars */}
                        <section className="mt-8">
                            <h2 className="text-lg font-bold mb-3">Allocation</h2>
                            <div className="surface rounded-2xl p-5 space-y-4">
                                {analysis.allocation.map((a, i) => (
                                    <div key={a.symbol}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="font-medium">
                                                {a.name}{" "}
                                                <span className="text-xs text-muted">
                                                    {a.symbol}
                                                </span>
                                            </span>
                                            <span className="text-muted">
                                                {a.percent.toFixed(1)}% · ₹{fmt(a.currentValue)}
                                            </span>
                                        </div>
                                        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${Math.max(a.percent, 1)}%`,
                                                    background: PALETTE[i % PALETTE.length],
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                        {/* Per-holding table */}
                        <section className="mt-8 pb-12">
                            <h2 className="text-lg font-bold mb-3">Holdings Detail</h2>
                            <div className="surface rounded-2xl overflow-hidden">
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
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysis.rows.map((h) => (
                                                <tr
                                                    key={h.symbol}
                                                    className="border-b border-white/5"
                                                >
                                                    <td className="p-4">
                                                        <p className="font-semibold">{h.name}</p>
                                                        <p className="text-xs text-muted">
                                                            {h.symbol}
                                                        </p>
                                                    </td>
                                                    <td className="text-right p-4">{h.qty}</td>
                                                    <td className="text-right p-4">
                                                        ₹{fmt(h.avgPrice)}
                                                    </td>
                                                    <td className="text-right p-4">
                                                        ₹{fmt(h.last)}
                                                    </td>
                                                    <td className="text-right p-4">
                                                        ₹{fmt(h.currentValue)}
                                                    </td>
                                                    <td
                                                        className={`text-right p-4 ${
                                                            h.pnl >= 0
                                                                ? "text-emerald-400"
                                                                : "text-red-400"
                                                        }`}
                                                    >
                                                        {signed(h.pnl)}
                                                        <span className="block text-xs">
                                                            {h.pnlPercent >= 0 ? "+" : ""}
                                                            {h.pnlPercent.toFixed(2)}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
function StatCard({ label, value, sub, valueClass }) {
    return (
        <div className="surface rounded-2xl p-5">
            <p className="text-sm text-muted font-medium">{label}</p>
            <p className={`text-2xl font-extrabold mt-2 tracking-tight ${valueClass || ""}`}>
                {value}
            </p>
            {sub && <p className={`text-sm mt-0.5 ${valueClass || "text-muted"}`}>{sub}</p>}
        </div>
    );
}
function MoverCard({ title, holding, positive, pricesLoaded }) {
    if (!holding) {
        return (
            <div className="surface rounded-2xl p-5">
                <p className="text-sm text-muted font-medium">{title}</p>
                <p className="text-muted text-sm mt-2">
                    {pricesLoaded ? "No data yet." : "Waiting for live prices…"}
                </p>
            </div>
        );
    }
    const up = holding.pnl >= 0;
    return (
        <div className="surface rounded-2xl p-5">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted font-medium">{title}</p>
                <span className={up ? "text-emerald-400" : "text-red-400"}>
                    {up ? <FaArrowUp /> : <FaArrowDown />}
                </span>
            </div>
            <p className="text-lg font-bold mt-2">{holding.name}</p>
            <p className="text-xs text-muted">{holding.symbol}</p>
            <p
                className={`text-sm mt-1 ${
                    up ? "text-emerald-400" : "text-red-400"
                }`}
            >
                {signed(holding.pnl)} ({holding.pnlPercent >= 0 ? "+" : ""}
                {holding.pnlPercent.toFixed(2)}%)
            </p>
        </div>
    );
}
export default PortfolioAnalysis;
