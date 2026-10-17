import { memo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";

import { getIndianQuotes, getQuotesFor } from "../services/indianStockService";
import authService from "../services/authService";
import { getAvatar } from "../services/profileService";

import NavBar from "../components/NavBar";
import TopTicker from "../components/TopTicker";

const fmt = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

// Full NSE universe mirroring backend StockUniverse.ALL. Bare tickers; the
// backend appends ".NS" when calling Yahoo.
const ALL_UNIVERSE = [
    { symbol: "RELIANCE", name: "Reliance Industries" },
    { symbol: "TCS", name: "Tata Consultancy Services" },
    { symbol: "INFY", name: "Infosys" },
    { symbol: "HDFCBANK", name: "HDFC Bank" },
    { symbol: "ICICIBANK", name: "ICICI Bank" },
    { symbol: "SBIN", name: "State Bank of India" },
    { symbol: "TATAMOTORS", name: "Tata Motors" },
    { symbol: "WIPRO", name: "Wipro" },
    { symbol: "HINDUNILVR", name: "Hindustan Unilever" },
    { symbol: "ITC", name: "ITC" },
    { symbol: "BHARTIARTL", name: "Bharti Airtel" },
    { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank" },
    { symbol: "LT", name: "Larsen & Toubro" },
    { symbol: "AXISBANK", name: "Axis Bank" },
    { symbol: "BAJFINANCE", name: "Bajaj Finance" },
    { symbol: "MARUTI", name: "Maruti Suzuki" },
    { symbol: "ASIANPAINT", name: "Asian Paints" },
    { symbol: "HCLTECH", name: "HCL Technologies" },
    { symbol: "SUNPHARMA", name: "Sun Pharmaceutical" },
    { symbol: "TITAN", name: "Titan Company" },
    { symbol: "ULTRACEMCO", name: "UltraTech Cement" },
    { symbol: "NESTLEIND", name: "Nestle India" },
    { symbol: "ADANIENT", name: "Adani Enterprises" },
    { symbol: "POWERGRID", name: "Power Grid Corporation" },
    { symbol: "NTPC", name: "NTPC" },
    { symbol: "ONGC", name: "Oil & Natural Gas Corporation" },
    { symbol: "TATASTEEL", name: "Tata Steel" },
    { symbol: "JSWSTEEL", name: "JSW Steel" },
    { symbol: "COALINDIA", name: "Coal India" },
];

const NIFTY_INDEX = [{ symbol: "NIFTY", name: "NIFTY 50" }];

function MarketDashboard() {
    const navigate = useNavigate();

    const [user, setUser] = useState(null);
    const [avatar, setAvatar] = useState(null);

    const [live, setLive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [nifty, setNifty] = useState(null);
    const [stocks, setStocks] = useState([]);
    const [topGainers, setTopGainers] = useState([]);
    const [topLosers, setTopLosers] = useState([]);

    // Resolve the signed-in user for the NavBar; redirect to login if absent.
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const current = await authService.getCurrentUser();
                if (!mounted) return;
                setUser(current);
                setAvatar(getAvatar(current.$id));
            } catch {
                navigate("/");
            }
        })();
        return () => {
            mounted = false;
        };
    }, [navigate]);

    // Poll every 15s. On a failed poll keep last data and surface a small error.
    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                const [{ watchlist, topGainers: g, topLosers: l }, idx] =
                    await Promise.all([
                        getIndianQuotes(ALL_UNIVERSE),
                        getQuotesFor(NIFTY_INDEX).catch(() => []),
                    ]);
                if (!mounted) return;
                setStocks(watchlist);
                setTopGainers(g);
                setTopLosers(l);
                setNifty(idx[0] || null);
                setLive(true);
                setError("");
            } catch (err) {
                if (mounted) {
                    setLive(false);
                    setError(err.message || "Failed to load market data");
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        const timer = setInterval(load, 15000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, []);

    const openStock = useCallback(
        (symbol) => navigate("/home", { state: { symbol } }),
        [navigate]
    );

    const logout = useCallback(async () => {
        await authService.logout();
        navigate("/");
    }, [navigate]);

    return (
        <div className="min-h-screen app-bg">
            <TopTicker />
            <NavBar
                user={{ ...user, avatarUrl: avatar }}
                onLogout={logout}
                live={live}
            />

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-extrabold tracking-tight">
                        NSE Market Dashboard
                    </h1>
                    <span
                        className={`text-xs font-bold whitespace-nowrap ${
                            live ? "text-emerald-400" : "text-muted"
                        }`}
                    >
                        {live ? "● LIVE" : "○ CONNECTING"}
                    </span>
                </div>

                {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

                {/* NIFTY index header */}
                <section className="surface rounded-2xl p-5 mb-8">
                    <p className="text-sm text-muted font-medium">NIFTY 50</p>
                    {nifty ? (
                        <div className="flex items-end gap-4 mt-2">
                            <span className="text-3xl font-extrabold tracking-tight">
                                ₹{nifty.value}
                            </span>
                            <span
                                className={`text-lg font-semibold ${
                                    nifty.positive ? "text-emerald-400" : "text-red-400"
                                }`}
                            >
                                {nifty.change} ({nifty.percentage})
                            </span>
                        </div>
                    ) : (
                        <p className="mt-2 text-muted text-sm">Loading index...</p>
                    )}
                </section>

                {/* All universe stocks */}
                <section className="mb-10">
                    <h2 className="text-lg font-bold mb-3">All Stocks</h2>
                    <div className="surface rounded-2xl overflow-hidden">
                        {loading && stocks.length === 0 ? (
                            <p className="p-5 text-muted text-sm">Loading quotes...</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-muted text-xs border-b border-white/10">
                                        <tr>
                                            <th className="text-left p-4">Stock</th>
                                            <th className="text-left p-4">Symbol</th>
                                            <th className="text-right p-4">Price</th>
                                            <th className="text-right p-4">Change</th>
                                            <th className="text-right p-4">Change %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stocks.map((s) => (
                                            <tr
                                                key={s.symbol}
                                                onClick={() => openStock(s.symbol)}
                                                className="border-b border-white/5 hover:bg-white/5 transition cursor-pointer"
                                            >
                                                <td className="p-4 font-semibold">{s.name}</td>
                                                <td className="p-4 text-muted">{s.symbol}</td>
                                                <td className="text-right p-4">₹{s.price}</td>
                                                <td
                                                    className={`text-right p-4 ${
                                                        s.positive
                                                            ? "text-emerald-400"
                                                            : "text-red-400"
                                                    }`}
                                                >
                                                    {s.change}
                                                </td>
                                                <td
                                                    className={`text-right p-4 ${
                                                        s.positive
                                                            ? "text-emerald-400"
                                                            : "text-red-400"
                                                    }`}
                                                >
                                                    {s.percentage}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </section>

                {/* Movers */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
                    <MoverCard
                        title="Top Gainers"
                        color="text-emerald-400"
                        icon={<FaArrowUp />}
                        items={topGainers}
                        onPick={openStock}
                    />
                    <MoverCard
                        title="Top Losers"
                        color="text-red-400"
                        icon={<FaArrowDown />}
                        items={topLosers}
                        onPick={openStock}
                    />
                </section>
            </main>
        </div>
    );
}

const MoverCard = memo(function MoverCard({ title, color, icon, items, onPick }) {
    return (
        <div className="surface rounded-2xl p-5">
            <h3 className={`font-bold mb-3 flex items-center gap-2 ${color}`}>
                {icon} {title}
            </h3>
            {items.length === 0 && <p className="text-muted text-sm">No data yet.</p>}
            {items.map((s) => (
                <button
                    key={s.symbol}
                    onClick={() => onPick(s.symbol)}
                    className="w-full flex justify-between py-3 border-b border-white/5 last:border-0 text-left hover:bg-white/5 transition"
                >
                    <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-muted">₹{fmt(s.rawPrice)}</p>
                    </div>
                    <span className={color}>{s.percentage}</span>
                </button>
            ))}
        </div>
    );
});

export default MarketDashboard;
