import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    FaArrowUp,
    FaArrowDown,
    FaWallet,
    FaPlus,
    FaMinus,
    FaChartLine,
} from "react-icons/fa";

import { getQuotesFor, INDIAN_STOCKS } from "../services/indianStockService";
import authService from "../services/authService";
import {
    fetchPortfolio,
    buyStock,
    sellStock,
    computeMetrics,
    computeRealizedPnl,
} from "../services/portfolioService";
import {
    getWatchlist,
    addToWatchlist,
    removeFromWatchlist,
} from "../services/watchlistService";
import { placeLimitOrder, getOrders } from "../services/orderService";
import { createStopLoss } from "../services/stopLossService";
import { getAvatar } from "../services/profileService";
import { payWithRazorpay } from "../services/paymentService";
import { useTheme } from "../context/ThemeContext";

import NavBar from "../components/NavBar";
import TopTicker from "../components/TopTicker";
import WatchlistSection from "../components/WatchlistSection";
import StockChart from "../components/StockChart";
import TradeModal from "../components/TradeModal";
import AddFundsModal from "../components/AddFundsModal";
import ChatBot from "../components/ChatBot";

const fmt = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

// Market indices / bellwethers shown in the top ticker. NIFTY maps to ^NSEI
// server-side; the rest are bare NSE tickers.
const INDEX_STOCKS = [
    { symbol: "NIFTY", name: "NIFTY 50" },
    { symbol: "RELIANCE", name: "Reliance Industries" },
];

function Home() {
    const navigate = useNavigate();
    const location = useLocation();
    const presetSymbol = location.state?.symbol || null;
    const { setThemeFromServer } = useTheme();

    const [user, setUser] = useState(null);
    const [avatar, setAvatar] = useState(null);
    const [loading, setLoading] = useState(true);

    // Explicit market-data status so the skeleton only shows while a request is
    // genuinely in flight: 'idle' (no symbols yet) | 'loading' | 'loaded' | 'error'.
    const [marketStatus, setMarketStatus] = useState("idle");
    const [lastUpdated, setLastUpdated] = useState(null);
    const [marketError, setMarketError] = useState("");
    const [live, setLive] = useState(false);
    const [indices, setIndices] = useState([]);
    const [watchStocks, setWatchStocks] = useState([]); // [{symbol,name}]
    const [quotes, setQuotes] = useState([]); // enriched quotes for watchStocks
    const [topGainers, setTopGainers] = useState([]);
    const [topLosers, setTopLosers] = useState([]);
    const [orders, setOrders] = useState([]); // executed/pending order history

    const [portfolio, setPortfolio] = useState({ wallet: 0, holdings: {} });
    const [selectedSymbol, setSelectedSymbol] = useState(presetSymbol);

    const [tradeModal, setTradeModal] = useState({ open: false, mode: "buy", stock: null });
    const [fundsOpen, setFundsOpen] = useState(false);
    const [toast, setToast] = useState("");

    // Live prices for holding symbols that aren't in the watchlist, so total
    // and per-holding P&L always use live data.
    const [holdingQuotes, setHoldingQuotes] = useState([]);

    // Keep the current watchStocks in a ref so the poll interval always reads
    // the latest list without needing to be re-created on every change.
    const watchRef = useRef(watchStocks);
    watchRef.current = watchStocks;

    // Keep the current portfolio in a ref so the poll can read holding symbols
    // without re-creating the interval on every portfolio change.
    const portfolioRef = useRef(portfolio);
    portfolioRef.current = portfolio;

    // Guards against overlapping fetches (poll + immediate refresh + Retry).
    const inFlightRef = useRef(false);

    const showToast = useCallback((msg) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    }, []);

    // Initial load: user + portfolio + watchlist
    useEffect(() => {
        const load = async () => {
            try {
                const current = await authService.getCurrentUser();
                setUser(current);
                setAvatar(getAvatar(current.$id));
                if (current.theme) setThemeFromServer(current.theme);

                const [pf, wl, ord] = await Promise.all([
                    fetchPortfolio(),
                    getWatchlist().catch(() => null),
                    // Order history powers Realized P&L. Offline -> empty list,
                    // so realized degrades to ₹0 + a hint rather than a wrong value.
                    getOrders().catch(() => []),
                ]);
                setPortfolio(pf);
                setOrders(Array.isArray(ord) ? ord : []);
                const baseStocks =
                    wl && wl.length
                        ? wl.map((w) => ({ symbol: w.symbol, name: w.name }))
                        : INDIAN_STOCKS.slice(0, 5);
                // If arriving from the Market Dashboard with a preselected
                // symbol, make sure it's quoted so its chart can open.
                if (
                    presetSymbol &&
                    !baseStocks.some((s) => s.symbol === presetSymbol)
                ) {
                    baseStocks.unshift({ symbol: presetSymbol, name: presetSymbol });
                }
                setWatchStocks(baseStocks);
            } catch {
                navigate("/");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [navigate, setThemeFromServer, presetSymbol]);

    // Fetch market data for indices + current watchlist + held symbols. Reads
    // the latest lists from refs so the poll/immediate/Retry callers all share
    // one implementation without re-creating the interval on every edit.
    const refreshMarket = useCallback(async () => {
        if (inFlightRef.current) return; // dedupe overlapping fetches
        const stocks = watchRef.current;
        // Holding symbols not already covered by the watchlist. Quoting these
        // keeps total/per-holding P&L on live prices regardless of the watchlist.
        const watchSymbols = new Set(stocks.map((s) => s.symbol));
        const held = portfolioRef.current.holdings || {};
        const extraHoldings = Object.values(held)
            .filter((h) => !watchSymbols.has(h.symbol))
            .map((h) => ({ symbol: h.symbol, name: h.name }));

        // Nothing saved to quote yet: stay idle rather than spinning forever.
        if (!stocks.length && !extraHoldings.length) {
            setMarketStatus("idle");
            return;
        }

        inFlightRef.current = true;
        setMarketStatus("loading");
        try {
            const [q, idx, hq] = await Promise.all([
                stocks.length ? getQuotesFor(stocks) : Promise.resolve([]),
                getQuotesFor(INDEX_STOCKS).catch(() => []),
                extraHoldings.length
                    ? getQuotesFor(extraHoldings).catch(() => [])
                    : Promise.resolve([]),
            ]);

            setQuotes(q);
            setHoldingQuotes(hq);
            setIndices(idx.length ? idx : q.slice(0, 4));
            const ranked = [...q].sort(
                (a, b) => Math.abs(b.rawChange) - Math.abs(a.rawChange)
            );
            setTopGainers(ranked.filter((s) => s.positive).slice(0, 3));
            setTopLosers(ranked.filter((s) => !s.positive).slice(0, 3));
            setLive(true);
            setMarketError("");
            setLastUpdated(new Date());
            setMarketStatus("loaded");

            setSelectedSymbol((cur) => cur || q[0]?.symbol || null);
        } catch (err) {
            setLive(false);
            setMarketError(err.message || "Failed to load market data");
            setMarketStatus("error");
        } finally {
            inFlightRef.current = false;
        }
    }, []);

    // Poll every 15s. Reads the latest lists from refs via refreshMarket.
    useEffect(() => {
        const timer = setInterval(refreshMarket, 15000);
        return () => clearInterval(timer);
    }, [refreshMarket]);

    // Trigger an immediate fetch as soon as the saved watchlist/holdings symbols
    // first become known, so the first quotes no longer wait up to 15s for the
    // next poll tick. Keyed on a stable symbol string.
    const symbolsKey = useMemo(() => {
        const watch = watchStocks.map((s) => s.symbol);
        const held = Object.keys(portfolio.holdings || {});
        return Array.from(new Set([...watch, ...held])).sort().join(",");
    }, [watchStocks, portfolio.holdings]);

    useEffect(() => {
        if (symbolsKey) refreshMarket();
    }, [symbolsKey, refreshMarket]);

    const livePrices = useMemo(() => {
        const map = new Map();
        quotes.forEach((s) => map.set(s.symbol, s.rawPrice));
        holdingQuotes.forEach((s) => map.set(s.symbol, s.rawPrice));
        return map;
    }, [quotes, holdingQuotes]);

    // Quotes keyed by symbol so the watchlist can render one row per SAVED
    // symbol and look up its (possibly missing) quote, instead of rendering
    // only the symbols that happen to have quotes.
    const quoteBySymbol = useMemo(() => {
        const map = new Map();
        quotes.forEach((q) => map.set(q.symbol, q));
        return map;
    }, [quotes]);

    const metrics = useMemo(
        () => computeMetrics(portfolio, livePrices),
        [portfolio, livePrices]
    );

    // Realized P&L replayed from executed order history (see portfolioService).
    const realized = useMemo(() => computeRealizedPnl(orders), [orders]);
    const totalReturn = metrics.totalPnl + realized.realizedPnl;
    const totalReturnPercent = metrics.invested
        ? (totalReturn / metrics.invested) * 100
        : 0;

    const openTrade = useCallback(
        (mode, stock) => setTradeModal({ open: true, mode, stock }),
        []
    );

    const confirmTrade = useCallback(
        async ({ symbol, name, price, qty, orderType }) => {
            try {
                if (orderType === "limit") {
                    await placeLimitOrder({
                        symbol,
                        name,
                        side: tradeModal.mode === "buy" ? "BUY" : "SELL",
                        price,
                        qty,
                    });
                    showToast(`Limit ${tradeModal.mode} order placed for ${name}`);
                } else {
                    const updated =
                        tradeModal.mode === "buy"
                            ? await buyStock({ symbol, name, price, qty })
                            : await sellStock({ symbol, price, qty });
                    setPortfolio({ ...updated });
                    // Refresh order history so Realized P&L reflects the new fill.
                    getOrders()
                        .then((o) => setOrders(Array.isArray(o) ? o : []))
                        .catch(() => {});
                    showToast(
                        `${tradeModal.mode === "buy" ? "Bought" : "Sold"} ${qty} ${name}`
                    );
                }
                setTradeModal({ open: false, mode: "buy", stock: null });
            } catch (err) {
                showToast(err.message);
            }
        },
        [tradeModal.mode, showToast]
    );

    const handleAddFunds = useCallback(
        async (amount) => {
            await payWithRazorpay({
                amount,
                user,
                onSuccess: async (r) => {
                    setPortfolio(await fetchPortfolio());
                    setFundsOpen(false);
                    showToast(
                        r.demo
                            ? `Added ₹${fmt(amount)} (demo mode)`
                            : `Payment successful: ₹${fmt(amount)}`
                    );
                },
                onFailure: (msg) => showToast(msg),
            });
        },
        [user, showToast]
    );

    const handleAddStock = useCallback(
        async (stock) => {
            if (watchRef.current.some((s) => s.symbol === stock.symbol)) {
                showToast(`${stock.name} is already in your watchlist`);
                return;
            }
            setWatchStocks((cur) => [...cur, { symbol: stock.symbol, name: stock.name }]);
            try {
                await addToWatchlist(stock.symbol, stock.name);
                const q = await getQuotesFor(watchRef.current);
                setQuotes(q);
                showToast(`Added ${stock.name}`);
            } catch {
                showToast("Could not save to watchlist");
            }
        },
        [showToast]
    );

    const handleRemoveStock = useCallback(async (symbol) => {
        setWatchStocks((cur) => cur.filter((s) => s.symbol !== symbol));
        setQuotes((cur) => cur.filter((s) => s.symbol !== symbol));
        try {
            await removeFromWatchlist(symbol);
        } catch {
            /* ignore */
        }
    }, []);

    // Set a REAL stop-loss on a held symbol. The backend scheduler auto-sells
    // the holding and emails the user when the live price falls to it.
    const handleSetStopLoss = useCallback(
        async (holding) => {
            const input = window.prompt(
                `Set a stop-loss for ${holding.symbol} (₹). When the live price falls to this, your holding is auto-sold.`,
                ""
            );
            if (input === null) return;
            const stopPrice = Number(String(input).trim());
            if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
                showToast("Enter a valid stop price");
                return;
            }
            try {
                await createStopLoss({
                    symbol: holding.symbol,
                    name: holding.name,
                    stopPrice,
                });
                showToast(`Stop-loss set for ${holding.symbol} at ₹${fmt(stopPrice)}`);
            } catch (err) {
                showToast(err.message);
            }
        },
        [showToast]
    );

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

    const selectedStock =
        quotes.find((s) => s.symbol === selectedSymbol) || quotes[0];
    const ownedQty = tradeModal.stock
        ? portfolio.holdings[tradeModal.stock.symbol]?.qty || 0
        : 0;

    return (
        <div className="min-h-screen app-bg">
            <TopTicker />
            <NavBar
                user={{ ...user, avatarUrl: avatar }}
                onLogout={logout}
                live={live}
                onPickStock={handleAddStock}
            />

            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Dashboard header (R5.6): a single titled block that groups the
                    page title, the LIVE/OFFLINE indicator, the index ticker strip,
                    and the "Updated HH:MM" status — instead of those pieces being
                    scattered across separate bars. Data sources/polling unchanged. */}
                <header className="surface rounded-2xl mb-8 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-extrabold tracking-tight">
                                Dashboard
                            </h1>
                            <span
                                className={`text-xs font-bold whitespace-nowrap ${
                                    live
                                        ? "text-emerald-400"
                                        : marketStatus === "error"
                                        ? "text-red-400"
                                        : "text-muted"
                                }`}
                            >
                                {live
                                    ? "● LIVE"
                                    : marketStatus === "error"
                                    ? "○ OFFLINE"
                                    : "○ CONNECTING"}
                            </span>
                        </div>

                        {/* Last-updated / error + Retry status, grouped in the header. */}
                        <div className="flex items-center gap-3 text-sm">
                            {marketStatus === "error" ? (
                                <span className="text-red-400">
                                    {marketError || "Failed to load market data"}
                                </span>
                            ) : marketStatus === "loaded" && lastUpdated ? (
                                <span className="text-muted">
                                    Updated {lastUpdated.toLocaleTimeString("en-IN")}
                                </span>
                            ) : marketStatus === "loading" ? (
                                <span className="text-muted">Updating…</span>
                            ) : null}
                            {marketStatus === "error" && (
                                <button
                                    onClick={refreshMarket}
                                    className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
                                >
                                    Retry
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Index ticker strip, now inside the dashboard header block. */}
                    <div className="mt-4 flex gap-8 overflow-x-auto items-center border-t border-white/10 pt-3">
                        {indices.map((m) => (
                            <div
                                key={m.symbol}
                                className="flex items-center gap-2 whitespace-nowrap"
                            >
                                <span className="text-sm text-muted">{m.name}</span>
                                <span className="font-semibold text-sm">₹{m.value}</span>
                                <span
                                    className={`text-xs ${
                                        m.positive ? "text-emerald-400" : "text-red-400"
                                    }`}
                                >
                                    {m.percentage}
                                </span>
                            </div>
                        ))}
                    </div>
                </header>

                {/* Portfolio summary cards. P&L is split into three distinct,
                    labeled measures: Open (unrealized) from live holdings, Realized
                    (booked from sold trades), and Total Return (Open + Realized). */}
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-in">
                    <SummaryCard
                        label="Total Value"
                        value={`₹${fmt(metrics.totalValue)}`}
                        sub="Holdings value + available cash"
                        icon={<FaChartLine />}
                        accent="from-indigo-500 to-purple-600"
                    />
                    <SummaryCard
                        label="Available Cash"
                        value={`₹${fmt(portfolio.wallet)}`}
                        sub="Uninvested wallet balance"
                        icon={<FaWallet />}
                        accent="from-sky-500 to-cyan-600"
                        action={
                            <button
                                onClick={() => setFundsOpen(true)}
                                className="mt-3 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                            >
                                + Add funds
                            </button>
                        }
                    />
                    <SummaryCard
                        label="Holdings Value"
                        value={`₹${fmt(metrics.holdingsValue)}`}
                        sub="Live market value of holdings"
                        icon={<FaChartLine />}
                        accent="from-emerald-500 to-teal-600"
                    />
                    <SummaryCard
                        label="Open P&L"
                        value={`${metrics.totalPnl >= 0 ? "+" : "-"}₹${fmt(Math.abs(metrics.totalPnl))}`}
                        sub={`Unrealized on current holdings · ${
                            metrics.totalPnlPercent >= 0 ? "+" : ""
                        }${metrics.totalPnlPercent.toFixed(2)}%`}
                        icon={metrics.totalPnl >= 0 ? <FaArrowUp /> : <FaArrowDown />}
                        accent={
                            metrics.totalPnl >= 0
                                ? "from-emerald-500 to-green-600"
                                : "from-red-500 to-rose-600"
                        }
                        valueClass={metrics.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
                    />
                    <SummaryCard
                        label="Realized P&L"
                        value={`${realized.realizedPnl >= 0 ? "+" : "-"}₹${fmt(Math.abs(realized.realizedPnl))}`}
                        sub={realized.hint || "Booked from sold trades"}
                        icon={realized.realizedPnl >= 0 ? <FaArrowUp /> : <FaArrowDown />}
                        accent={
                            realized.realizedPnl >= 0
                                ? "from-emerald-500 to-green-600"
                                : "from-red-500 to-rose-600"
                        }
                        valueClass={
                            realized.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }
                    />
                    <SummaryCard
                        label="Total Return"
                        value={`${totalReturn >= 0 ? "+" : "-"}₹${fmt(Math.abs(totalReturn))}`}
                        sub={`Open + Realized${
                            metrics.invested
                                ? ` · ${totalReturnPercent >= 0 ? "+" : ""}${totalReturnPercent.toFixed(2)}%`
                                : ""
                        }`}
                        icon={totalReturn >= 0 ? <FaArrowUp /> : <FaArrowDown />}
                        accent={
                            totalReturn >= 0
                                ? "from-emerald-500 to-green-600"
                                : "from-red-500 to-rose-600"
                        }
                        valueClass={totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}
                    />
                </section>

                {/* Chart + watchlist */}
                <section className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        {selectedStock ? (
                            <StockChart symbol={selectedStock.symbol} name={selectedStock.name} />
                        ) : marketStatus === "error" ? (
                            <div className="surface rounded-2xl h-100 flex flex-col items-center justify-center gap-3 text-muted">
                                <span className="text-red-400 text-sm">
                                    Couldn’t load market data.
                                </span>
                                <button
                                    onClick={refreshMarket}
                                    className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : marketStatus === "idle" ? (
                            <div className="surface rounded-2xl h-100 flex items-center justify-center text-muted text-sm">
                                Add a stock to your watchlist to see its chart.
                            </div>
                        ) : (
                            <div className="surface rounded-2xl h-100 flex items-center justify-center text-muted">
                                Loading chart...
                            </div>
                        )}

                        {selectedStock && (
                            <div className="mt-4 flex items-center gap-3">
                                <button
                                    onClick={() => openTrade("buy", selectedStock)}
                                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2"
                                >
                                    <FaPlus size={12} /> Buy {selectedStock.symbol.split(":")[0]}
                                </button>
                                <button
                                    onClick={() => openTrade("sell", selectedStock)}
                                    className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-2"
                                >
                                    <FaMinus size={12} /> Sell {selectedStock.symbol.split(":")[0]}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Watchlist: dedicated, distinctly-delineated panel next to
                        the chart (R5.1). Presentational component owns its own
                        header/count; state + handlers stay here in Home. */}
                    <div>
                        <WatchlistSection
                            watchStocks={watchStocks}
                            quoteBySymbol={quoteBySymbol}
                            marketStatus={marketStatus}
                            selectedSymbol={selectedSymbol}
                            onSelect={setSelectedSymbol}
                            onRemove={handleRemoveStock}
                        />
                    </div>
                </section>

                {/* Holdings */}
                <section className="mt-10">
                    <h2 className="text-lg font-bold mb-3">Your Holdings</h2>
                    <div className="surface rounded-2xl overflow-hidden">
                        {metrics.holdings.length === 0 ? (
                            <p className="p-6 text-muted text-sm text-center">
                                No holdings yet. Select a stock and hit Buy to get started.
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
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => handleSetStopLoss(h)}
                                                            className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
                                                            title="Set a stop-loss (auto-sell)"
                                                        >
                                                            SL
                                                        </button>
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
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </section>

                {/* Movers. These rank ONLY the loaded watchlist quotes, not the
                    whole NSE market, so they are labeled "Watchlist" to be honest
                    about scope. A market-wide movers source is a planned separate
                    task (dedicated Markets screener). */}
                <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
                    <MoverCard title="Watchlist Gainers" color="text-emerald-400" items={topGainers} />
                    <MoverCard title="Watchlist Losers" color="text-red-400" items={topLosers} />
                </section>
            </main>

            <TradeModal
                open={tradeModal.open}
                mode={tradeModal.mode}
                stock={tradeModal.stock}
                wallet={portfolio.wallet}
                ownedQty={ownedQty}
                onClose={() => setTradeModal({ open: false, mode: "buy", stock: null })}
                onConfirm={confirmTrade}
            />

            <AddFundsModal
                open={fundsOpen}
                onClose={() => setFundsOpen(false)}
                onPay={handleAddFunds}
            />

            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-200 surface px-5 py-3 rounded-xl shadow-2xl text-sm font-medium">
                    {toast}
                </div>
            )}

            <ChatBot />
        </div>
    );
}

const SummaryCard = memo(function SummaryCard({ label, value, sub, icon, accent, action, valueClass }) {
    return (
        <div className="surface card-hover rounded-2xl p-5">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted font-medium">{label}</p>
                <div
                    className={`h-9 w-9 rounded-xl bg-linear-to-br ${accent} flex items-center justify-center text-white text-sm shadow-lg`}
                >
                    {icon}
                </div>
            </div>
            <p className={`text-2xl font-extrabold mt-3 tracking-tight ${valueClass || ""}`}>
                {value}
            </p>
            {sub && <p className={`text-sm mt-0.5 ${valueClass || "text-muted"}`}>{sub}</p>}
            {action}
        </div>
    );
});

const MoverCard = memo(function MoverCard({ title, color, items }) {
    return (
        <div className="surface rounded-2xl p-5">
            <h3 className={`font-bold mb-3 ${color}`}>{title}</h3>
            {items.length === 0 && <p className="text-muted text-sm">No data yet.</p>}
            {items.map((s) => (
                <div
                    key={s.symbol}
                    className="flex justify-between py-3 border-b border-white/5 last:border-0"
                >
                    <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-muted">₹{fmt(s.rawPrice)}</p>
                    </div>
                    <span className={color}>{s.percentage}</span>
                </div>
            ))}
        </div>
    );
});

export default Home;
