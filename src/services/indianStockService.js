// Indian (NSE) live stock data via the backend market proxy.
// The backend fetches from Yahoo Finance (free, no key) and returns bare-symbol
// quotes/candles; Yahoo blocks browser CORS, so everything routes through api().

import { api } from "./apiClient";

// Bare NSE tickers. The backend appends ".NS" (and maps NIFTY -> ^NSEI) when
// calling Yahoo, so the UI and storage always use the bare symbol.
export const INDIAN_STOCKS = [
    { symbol: "RELIANCE", name: "Reliance Industries" },
    { symbol: "TCS", name: "Tata Consultancy Services" },
    { symbol: "INFY", name: "Infosys" },
    { symbol: "HDFCBANK", name: "HDFC Bank" },
    { symbol: "ICICIBANK", name: "ICICI Bank" },
    { symbol: "SBIN", name: "State Bank of India" },
    { symbol: "TATAMOTORS", name: "Tata Motors" },
    { symbol: "WIPRO", name: "Wipro" },
];

export const INDIAN_SYMBOLS = INDIAN_STOCKS.map((stock) => stock.symbol);

function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatSigned(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    const abs = Math.abs(n).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return n >= 0 ? `+${abs}` : `-${abs}`;
}

// Maps a backend QuoteDto {symbol,name,price,previousClose,change,percent} to
// the UI shape the rest of the app expects.
function mapStockQuote(stock, quote = {}) {
    const price = Number(quote.price) || 0;
    const previousClose = Number(quote.previousClose) || 0;
    const change =
        Number(quote.change) || (previousClose ? price - previousClose : 0);
    const percent =
        Number(quote.percent) ||
        (previousClose ? (change / previousClose) * 100 : 0);

    return {
        name: quote.name || stock.name,
        symbol: stock.symbol,
        previousClose,
        rawPrice: price,
        rawChange: change,
        price: formatMoney(price),
        value: formatMoney(price),
        change: formatSigned(change),
        percentage: `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`,
        positive: change >= 0,
    };
}

// Fetch quotes for an arbitrary list of {symbol, name}. Batched into one call.
// Cached briefly to dedupe rapid re-requests (e.g. multiple components).
const quoteCache = new Map(); // key -> { at, data }
const CACHE_MS = 10000;

export async function getQuotesFor(stocks) {
    if (!stocks?.length) return [];
    const symbols = stocks.map((s) => s.symbol);
    const key = symbols.join(",");

    const cached = quoteCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
        return cached.data;
    }

    const rows = await api(
        `/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`
    );
    const bySymbol = new Map(
        (Array.isArray(rows) ? rows : []).map((q) => [q.symbol, q])
    );

    // Always return one row per requested stock; a missing symbol falls back to
    // a placeholder so one bad symbol can't blank the whole watchlist.
    const quotes = stocks.map((stock) =>
        mapStockQuote(stock, bySymbol.get(stock.symbol) || {})
    );

    quoteCache.set(key, { at: Date.now(), data: quotes });
    return quotes;
}

export async function getIndianQuotes(watchStocks = INDIAN_STOCKS) {
    const quotes = await getQuotesFor(watchStocks);

    const ranked = [...quotes].sort(
        (a, b) => Math.abs(b.rawChange) - Math.abs(a.rawChange)
    );

    return {
        indices: quotes.slice(0, 4),
        watchlist: quotes,
        topGainers: ranked.filter((stock) => stock.positive).slice(0, 3),
        topLosers: ranked.filter((stock) => !stock.positive).slice(0, 3),
    };
}

// Historical/intraday candles for a symbol (for live charts).
// interval is one of the chart buttons: "5min", "15min", "1h", "1day".
// outputsize is accepted for call-site compatibility; the backend picks the
// Yahoo range per interval.
export async function getTimeSeries(symbol, interval = "5min") {
    const rows = await api(
        `/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
            interval
        )}`
    );

    // Backend returns { time (epoch seconds), open, high, low, close } ascending,
    // which is exactly what lightweight-charts wants.
    return (Array.isArray(rows) ? rows : []).map((v) => ({
        time: Number(v.time),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
    }));
}
