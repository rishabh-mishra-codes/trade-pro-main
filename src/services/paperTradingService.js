// Paper (virtual) trading portfolio. Lives entirely in localStorage under its
// own key so it NEVER touches the real wallet/holdings ("tradepro_portfolio")
// or the backend. Starts with 100000 virtual rupees. Holdings carry an optional
// client-side stopLoss used by the paper page's poll to auto-sell.

const STORAGE_KEY = "tradepro_paper_portfolio";
const STARTING_BALANCE = 100000;

function read() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        /* ignore */
    }
    return { wallet: STARTING_BALANCE, holdings: {} };
}

function write(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
}

export function readPaper() {
    return read();
}

export function buyPaper({ symbol, name, price, qty }) {
    const state = read();
    const cost = price * qty;
    if (cost > state.wallet) throw new Error("Insufficient virtual balance for this trade");
    const existing = state.holdings[symbol];
    if (existing) {
        const totalQty = existing.qty + qty;
        existing.avgPrice = Number(
            ((existing.avgPrice * existing.qty + cost) / totalQty).toFixed(2)
        );
        existing.qty = totalQty;
    } else {
        state.holdings[symbol] = {
            symbol,
            name,
            qty,
            avgPrice: Number(price.toFixed(2)),
            stopLoss: null,
        };
    }
    state.wallet = Number((state.wallet - cost).toFixed(2));
    return write(state);
}

export function sellPaper({ symbol, price, qty }) {
    const state = read();
    const existing = state.holdings[symbol];
    if (!existing || existing.qty < qty)
        throw new Error("You don't own enough virtual shares to sell");
    existing.qty -= qty;
    if (existing.qty === 0) delete state.holdings[symbol];
    state.wallet = Number((state.wallet + price * qty).toFixed(2));
    return write(state);
}

export function resetPaper() {
    return write({ wallet: STARTING_BALANCE, holdings: {} });
}

export function setStopLoss(symbol, stopPrice) {
    const state = read();
    const existing = state.holdings[symbol];
    if (existing) {
        existing.stopLoss = Number(stopPrice) || null;
        write(state);
    }
    return state;
}

export function clearStopLoss(symbol) {
    const state = read();
    const existing = state.holdings[symbol];
    if (existing) {
        existing.stopLoss = null;
        write(state);
    }
    return state;
}

// Compute metrics against live prices. livePrices: Map<symbol, rawPrice>.
// Same math as portfolioService.computeMetrics.
export function computePaperMetrics(state, livePrices) {
    const holdings = Object.values(state.holdings).map((h) => {
        const last = livePrices.get(h.symbol) ?? h.avgPrice;
        const marketValue = last * h.qty;
        const invested = h.avgPrice * h.qty;
        const pnl = marketValue - invested;
        return {
            ...h,
            last,
            marketValue,
            invested,
            pnl,
            pnlPercent: invested ? (pnl / invested) * 100 : 0,
        };
    });

    const holdingsValue = holdings.reduce((s, h) => s + h.marketValue, 0);
    const invested = holdings.reduce((s, h) => s + h.invested, 0);
    const totalPnl = holdingsValue - invested;

    return {
        holdings,
        holdingsValue,
        invested,
        totalPnl,
        totalPnlPercent: invested ? (totalPnl / invested) * 100 : 0,
        totalValue: holdingsValue + state.wallet,
    };
}
