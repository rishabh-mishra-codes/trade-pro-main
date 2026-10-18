import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import authService from "../services/authService";
import { getAvatar } from "../services/profileService";
import {
    getWatchlist,
    addToWatchlist,
    removeFromWatchlist,
} from "../services/watchlistService";
import { getQuotesFor } from "../services/indianStockService";
import NavBar from "../components/NavBar";
import StockSearch from "../components/StockSearch";
import WatchlistSection from "../components/WatchlistSection";

// Dedicated Watchlist page. Mirrors the Orders/PortfolioAnalysis shell (NavBar,
// max-w container, "Back to dashboard", <h1>) and reuses the presentational
// WatchlistSection. Live quotes poll every 15s with a mounted-guard, exactly
// like PortfolioAnalysis.jsx.
function Watchlist() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [watchStocks, setWatchStocks] = useState([]); // [{ symbol, name }]
    const [quoteBySymbol, setQuoteBySymbol] = useState(new Map());
    const [marketStatus, setMarketStatus] = useState("idle"); // idle|loading|loaded|error
    const [selectedSymbol] = useState(null);

    // Keep the saved list in a ref so the 15s poll reads the latest symbols
    // without re-creating the interval.
    const watchRef = useRef(watchStocks);
    watchRef.current = watchStocks;

    // Initial load: user + saved watchlist.
    useEffect(() => {
        const init = async () => {
            try {
                const u = await authService.getCurrentUser();
                setUser({ ...u, avatarUrl: getAvatar(u.$id) });
                const list = await getWatchlist().catch(() => []);
                setWatchStocks(Array.isArray(list) ? list : []);
            } catch {
                navigate("/");
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [navigate]);

    // Poll live quotes for the saved symbols every 15s.
    useEffect(() => {
        let mounted = true;
        const loadQuotes = async () => {
            const stocks = watchRef.current || [];
            if (!stocks.length) {
                if (mounted) {
                    setQuoteBySymbol(new Map());
                    setMarketStatus("loaded");
                }
                return;
            }
            if (mounted) setMarketStatus("loading");
            try {
                const quotes = await getQuotesFor(stocks);
                if (!mounted) return;
                const map = new Map();
                quotes.forEach((q) => map.set(q.symbol, q));
                setQuoteBySymbol(map);
                setMarketStatus("loaded");
            } catch {
                if (mounted) setMarketStatus("error");
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

    // Add a picked stock, then refetch the saved list so the section reflects it.
    const handleAdd = useCallback(async (stock) => {
        if (!stock?.symbol) return;
        try {
            await addToWatchlist(stock.symbol, stock.name);
            const list = await getWatchlist().catch(() => null);
            if (Array.isArray(list)) {
                setWatchStocks(list);
            } else {
                // Fallback: optimistically append if the refetch didn't return a list.
                setWatchStocks((prev) =>
                    prev.some((s) => s.symbol === stock.symbol)
                        ? prev
                        : [...prev, { symbol: stock.symbol, name: stock.name }]
                );
            }
        } catch {
            /* ignore */
        }
    }, []);

    const handleRemove = useCallback(async (symbol) => {
        try {
            await removeFromWatchlist(symbol);
        } catch {
            /* ignore */
        }
        setWatchStocks((prev) => prev.filter((s) => s.symbol !== symbol));
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen app-bg flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen app-bg">
            <NavBar user={user} onLogout={logout} live onPickStock={handleAdd} />
            <main className="max-w-4xl mx-auto px-6 py-8">
                <button
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-2 text-muted hover:text-current mb-6"
                >
                    <FaArrowLeft /> Back to dashboard
                </button>
                <h1 className="text-2xl font-bold mb-1">Watchlist</h1>
                <p className="text-sm text-muted mb-6">
                    Your saved stocks with live quotes, refreshed every 15 seconds.
                </p>
                <div className="mb-5">
                    <StockSearch onPick={handleAdd} />
                </div>
                <WatchlistSection
                    watchStocks={watchStocks}
                    quoteBySymbol={quoteBySymbol}
                    marketStatus={marketStatus}
                    selectedSymbol={selectedSymbol}
                    onSelect={(sym) => navigate("/home", { state: { symbol: sym } })}
                    onRemove={handleRemove}
                />
            </main>
        </div>
    );
}

export default Watchlist;
