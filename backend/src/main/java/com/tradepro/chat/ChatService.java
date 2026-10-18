package com.tradepro.chat;
import com.tradepro.market.StockUniverse;
import com.tradepro.market.YahooFinanceClient;
import com.tradepro.trade.Holding;
import com.tradepro.trade.TradeService;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
@Service
public class ChatService {
    private final GeminiClient gemini;
    private final TradeService tradeService;
    private final YahooFinanceClient marketClient;
    /** Max number of non-held (extra) stocks whose prices we fetch per question. */
    private static final int MAX_EXTRA_SYMBOLS = 5;
    public ChatService(
            GeminiClient gemini,
            TradeService tradeService,
            YahooFinanceClient marketClient) {
        this.gemini = gemini;
        this.tradeService = tradeService;
        this.marketClient = marketClient;
    }
    public String answer(UUID userId, String question) {
        if (question == null || question.isBlank()) {
            return "Ask me about your holdings, P&L, cash balance, or a stock price.";
        }
        double wallet = tradeService.getWallet(userId);
        List<Holding> holdings = tradeService.getHoldings(userId);
        // Symbols the user already holds.
        Set<String> held = new LinkedHashSet<>();
        for (Holding h : holdings) {
            if (h != null && h.getSymbol() != null) {
                held.add(h.getSymbol());
            }
        }
        // Symbols named in the question (best effort, capped), excluding held ones.
        List<String> mentioned = detectMentionedSymbols(question, held);
        // Build a distinct union: holdings first, then extra mentioned symbols.
        List<String> union = new ArrayList<>(held);
        union.addAll(mentioned);
        // Fetch live prices for the union (best effort; never throw).
        Map<String, Double> prices = Map.of();
        if (!union.isEmpty()) {
            try {
                Map<String, Double> fetched = marketClient.getPrices(union);
                if (fetched != null) {
                    prices = fetched;
                }
            } catch (RuntimeException ignored) {
                // best effort: leave prices empty / fall back in prompt
            }
        }
        // DETERMINISTIC FAST-PATH: answer common questions directly from live data,
        // so the client always gets real-time data even if Gemini is slow/unavailable.
        String direct = tryDirectAnswer(question, wallet, holdings, prices, mentioned);
        if (direct != null && !direct.isBlank()) {
            return direct;
        }
        // Fall through to Gemini for general / natural-language questions.
        String prompt = buildPrompt(wallet, holdings, prices, question);
        return gemini.generate(prompt);
    }
    /**
     * Deterministic, null-safe fast-path for the most common questions (stock price,
     * cash balance, holdings, P&amp;L). Returns a concise, ready-to-send reply built
     * from live data, or {@code null} if the question is not one of these intents
     * (in which case the caller falls back to Gemini). Never throws.
     */
    private String tryDirectAnswer(
            String question, double wallet, List<Holding> holdings,
            Map<String, Double> prices, List<String> mentioned) {
        try {
            if (question == null || question.isBlank()) {
                return null;
            }
            String q = question.toLowerCase(Locale.ENGLISH);
            if (holdings == null) {
                holdings = new ArrayList<>();
            }
            if (prices == null) {
                prices = Map.of();
            }
            // Symbols the user holds (bare symbols).
            Set<String> held = new LinkedHashSet<>();
            for (Holding h : holdings) {
                if (h != null && h.getSymbol() != null) {
                    held.add(h.getSymbol());
                }
            }
            // --- PRICE intent ---------------------------------------------------
            boolean priceIntent =
                    q.contains("price") || q.contains("trading") || q.contains("trade at")
                    || q.contains("ltp") || q.contains("quote") || q.contains("rate")
                    || q.contains("how much is") || q.contains("value of") || q.contains("worth");
            if (priceIntent) {
                // Collect matched symbols: mentioned ones plus any held symbol named in the question.
                LinkedHashSet<String> targets = new LinkedHashSet<>();
                if (mentioned != null) {
                    for (String m : mentioned) {
                        if (m != null && !m.isBlank()) {
                            targets.add(m);
                        }
                    }
                }
                for (String sym : held) {
                    if (symbolNamedInQuestion(q, sym)) {
                        targets.add(sym);
                    }
                }
                if (!targets.isEmpty()) {
                    StringBuilder sb = new StringBuilder();
                    int priced = 0;
                    String firstMissing = null;
                    for (String sym : targets) {
                        Double live = livePrice(sym, prices);
                        Double chgPct = null;
                        if (live == null) {
                            // Direct fallback to a fresh quote.
                            YahooFinanceClient.QuoteDto quote = safeQuote(sym);
                            if (quote != null) {
                                live = quote.price();
                                chgPct = quote.percent();
                            }
                        } else {
                            // We have a map price; try to enrich with change% from a quote (best effort).
                            YahooFinanceClient.QuoteDto quote = safeQuote(sym);
                            if (quote != null) {
                                chgPct = quote.percent();
                            }
                        }
                        if (live == null) {
                            if (firstMissing == null) {
                                firstMissing = sym;
                            }
                            continue;
                        }
                        String name = displayName(sym);
                        if (chgPct != null) {
                            sb.append(String.format(Locale.ENGLISH,
                                    "%s (%s) is trading at \u20B9%,.2f (%+.2f%%).",
                                    name, sym, live, chgPct));
                        } else {
                            sb.append(String.format(Locale.ENGLISH,
                                    "%s (%s) is trading at \u20B9%,.2f.",
                                    name, sym, live));
                        }
                        sb.append('\n');
                        priced++;
                    }
                    if (priced == 0) {
                        String sym = firstMissing != null ? firstMissing : targets.iterator().next();
                        return "I couldn't fetch a live price for " + sym
                                + " right now \u2014 the market data source may be rate-limited. "
                                + "Please try again in a moment.";
                    }
                    return sb.toString().trim();
                }
                // Price intent but no symbol matched: let other intents / Gemini handle it.
            }
            // --- CASH intent ----------------------------------------------------
            if (q.contains("cash") || q.contains("balance") || q.contains("wallet")
                    || q.contains("funds")) {
                return String.format(Locale.ENGLISH,
                        "Your available cash balance is \u20B9%,.2f.", wallet);
            }
            // --- HOLDINGS intent ------------------------------------------------
            if (q.contains("holdings") || q.contains("holding") || q.contains("portfolio")
                    || q.contains("what do i own") || q.contains("my stocks")) {
                if (holdings.isEmpty()) {
                    return String.format(Locale.ENGLISH,
                            "You don't have any holdings yet. Your available cash balance is \u20B9%,.2f.",
                            wallet);
                }
                StringBuilder sb = new StringBuilder("Your holdings:\n");
                double totalValue = 0.0;
                double totalInvested = 0.0;
                for (Holding h : holdings) {
                    if (h == null || h.getSymbol() == null) {
                        continue;
                    }
                    String sym = h.getSymbol();
                    int qty = h.getQuantity();
                    double avg = h.getAvgPrice();
                    double last = priceOrAvg(sym, prices, avg);
                    double value = last * qty;
                    double invested = avg * qty;
                    double pnl = value - invested;
                    totalValue += value;
                    totalInvested += invested;
                    String name = h.getName() != null ? h.getName() : displayName(sym);
                    sb.append(String.format(Locale.ENGLISH,
                            "- %s (%s): qty %d @ avg \u20B9%,.2f, LTP \u20B9%,.2f, value \u20B9%,.2f, P&L \u20B9%,.2f%n",
                            name, sym, qty, avg, last, value, pnl));
                }
                double totalPnl = totalValue - totalInvested;
                sb.append(String.format(Locale.ENGLISH,
                        "Total: holdings value \u20B9%,.2f, invested \u20B9%,.2f, P&L \u20B9%,.2f, "
                        + "available cash \u20B9%,.2f, total portfolio \u20B9%,.2f.",
                        totalValue, totalInvested, totalPnl, wallet, wallet + totalValue));
                return sb.toString().trim();
            }
            // --- P&L intent -----------------------------------------------------
            if (q.contains("p&l") || q.contains("pnl") || q.contains("profit")
                    || q.contains("loss") || q.contains("gain") || q.contains("return")
                    || q.contains("how am i doing")) {
                double totalValue = 0.0;
                double totalInvested = 0.0;
                for (Holding h : holdings) {
                    if (h == null || h.getSymbol() == null) {
                        continue;
                    }
                    String sym = h.getSymbol();
                    int qty = h.getQuantity();
                    double avg = h.getAvgPrice();
                    double last = priceOrAvg(sym, prices, avg);
                    totalValue += last * qty;
                    totalInvested += avg * qty;
                }
                double unrealized = totalValue - totalInvested;
                double pct = totalInvested != 0.0 ? (unrealized / totalInvested) * 100.0 : 0.0;
                return String.format(Locale.ENGLISH,
                        "Open P&L: \u20B9%,.2f (%+.2f%%). Holdings value \u20B9%,.2f, invested \u20B9%,.2f, "
                        + "available cash \u20B9%,.2f, total portfolio \u20B9%,.2f.",
                        unrealized, pct, totalValue, totalInvested, wallet, wallet + totalValue);
            }
            return null;
        } catch (RuntimeException ignored) {
            // Never throw from the fast-path: fall back to Gemini.
            return null;
        }
    }
    /** Live price from the prices map (bare symbol key), or {@code null} if absent/invalid. */
    private Double livePrice(String sym, Map<String, Double> prices) {
        if (sym == null || prices == null) {
            return null;
        }
        Double p = prices.get(sym);
        if (p == null || p.isNaN() || p.isInfinite() || p <= 0.0) {
            return null;
        }
        return p;
    }
    /**
     * Resolve a usable last price for a symbol: prefer the prices map, then a fresh
     * {@code getQuote}, then fall back to the supplied average price. Never throws.
     */
    private double priceOrAvg(String sym, Map<String, Double> prices, double avg) {
        Double live = livePrice(sym, prices);
        if (live != null) {
            return live;
        }
        YahooFinanceClient.QuoteDto quote = safeQuote(sym);
        if (quote != null) {
            double price = quote.price();
            if (!Double.isNaN(price) && !Double.isInfinite(price) && price > 0.0) {
                return price;
            }
        }
        return avg;
    }
    /** Fetch a quote without ever throwing; returns {@code null} on any failure. */
    private YahooFinanceClient.QuoteDto safeQuote(String bareSymbol) {
        if (bareSymbol == null || bareSymbol.isBlank()) {
            return null;
        }
        try {
            return marketClient.getQuote(bareSymbol);
        } catch (RuntimeException ignored) {
            return null;
        }
    }
    /** Friendly display name for a symbol, falling back to the symbol itself. */
    private String displayName(String sym) {
        if (sym == null) {
            return "";
        }
        String name = StockUniverse.nameFor(sym);
        return (name != null && !name.isBlank()) ? name : sym;
    }
    /**
     * True if the symbol is named in the (already lower-cased) question, either by
     * its symbol token or by its display name. Best effort; never throws.
     */
    private boolean symbolNamedInQuestion(String lowerQuestion, String sym) {
        if (lowerQuestion == null || sym == null || sym.isBlank()) {
            return false;
        }
        String symLower = sym.toLowerCase(Locale.ENGLISH);
        if (lowerQuestion.contains(symLower)) {
            return true;
        }
        String name = StockUniverse.nameFor(sym);
        if (name != null && !name.isBlank()) {
            String nameLower = name.toLowerCase(Locale.ENGLISH);
            if (lowerQuestion.contains(nameLower)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Detect stock symbols named in the free-text question. Tokenizes the question
     * into UPPERCASE alphanumeric tokens and matches each StockUniverse entry when
     * either the symbol appears as an exact token (avoids short false hits) or any
     * token of length >= 4 is contained in the stock's name. Held symbols are
     * excluded and the number of extra matches is capped. Never throws.
     */
    private List<String> detectMentionedSymbols(String question, Set<String> held) {
        List<String> matches = new ArrayList<>();
        try {
            if (question == null || question.isBlank()) {
                return matches;
            }
            String[] rawTokens = question.toUpperCase(Locale.ENGLISH).split("[^A-Za-z0-9]+");
            Set<String> tokens = new HashSet<>();
            for (String t : rawTokens) {
                if (t != null && !t.isEmpty()) {
                    tokens.add(t);
                }
            }
            if (tokens.isEmpty()) {
                return matches;
            }
            // Tokens long enough to match against stock names.
            List<String> longTokens = new ArrayList<>();
            for (String t : tokens) {
                if (t.length() >= 4) {
                    longTokens.add(t);
                }
            }
            Set<String> seen = new HashSet<>();
            for (StockUniverse.Stock s : StockUniverse.ALL) {
                if (s == null || s.symbol() == null) {
                    continue;
                }
                String symbol = s.symbol();
                String symbolUpper = symbol.toUpperCase(Locale.ENGLISH);
                String nameUpper = s.name() == null ? "" : s.name().toUpperCase(Locale.ENGLISH);
                boolean matched = tokens.contains(symbolUpper);
                if (!matched) {
                    for (String t : longTokens) {
                        if (!nameUpper.isEmpty() && nameUpper.contains(t)) {
                            matched = true;
                            break;
                        }
                    }
                }
                if (!matched) {
                    continue;
                }
                if (held.contains(symbol) || !seen.add(symbol)) {
                    continue;
                }
                matches.add(symbol);
                if (matches.size() >= MAX_EXTRA_SYMBOLS) {
                    break;
                }
            }
        } catch (RuntimeException ignored) {
            // best effort: return whatever matched so far (possibly empty)
        }
        return matches;
    }
    private String buildPrompt(
            double wallet, List<Holding> holdings,
            Map<String, Double> prices, String question) {
        StringBuilder ctx = new StringBuilder();
        ctx.append("You are TradePro Assistant, a concise, friendly assistant inside a ")
           .append("stock trading app for Indian (NSE) markets. Answer ONLY using the ")
           .append("portfolio data and live prices provided below. If asked something ")
           .append("outside this data or for financial advice, say you can share data ")
           .append("but cannot give investment advice. Use ₹ for money. Keep answers short.\n\n");
        ctx.append("=== USER PORTFOLIO ===\n");
        ctx.append(String.format(Locale.ENGLISH, "Available cash: ₹%,.2f%n", wallet));
        if (holdings.isEmpty()) {
            ctx.append("Holdings: none yet.\n");
        } else {
            ctx.append("Holdings:\n");
            double totalValue = 0, totalInvested = 0;
            for (Holding h : holdings) {
                double last = prices.getOrDefault(h.getSymbol(), h.getAvgPrice());
                double value = last * h.getQuantity();
                double invested = h.getAvgPrice() * h.getQuantity();
                double pnl = value - invested;
                totalValue += value;
                totalInvested += invested;
                ctx.append(String.format(Locale.ENGLISH,
                        "- %s (%s): qty %d, avg ₹%,.2f, LTP ₹%,.2f, value ₹%,.2f, P&L ₹%,.2f%n",
                        h.getName(), h.getSymbol(), h.getQuantity(),
                        h.getAvgPrice(), last, value, pnl));
            }
            double totalPnl = totalValue - totalInvested;
            ctx.append(String.format(Locale.ENGLISH,
                    "Total holdings value: ₹%,.2f | Invested: ₹%,.2f | Total P&L: ₹%,.2f%n",
                    totalValue, totalInvested, totalPnl));
            ctx.append(String.format(Locale.ENGLISH,
                    "Total portfolio (cash + holdings): ₹%,.2f%n", wallet + totalValue));
        }
        if (!prices.isEmpty()) {
            ctx.append("\nLive prices:\n");
            prices.forEach((sym, p) ->
                    ctx.append(String.format(Locale.ENGLISH, "- %s: ₹%,.2f%n", sym, p)));
        } else {
            ctx.append("\n(Live prices are currently unavailable.)\n");
        }
        ctx.append("\n=== USER QUESTION ===\n").append(question);
        return ctx.toString();
    }
}
