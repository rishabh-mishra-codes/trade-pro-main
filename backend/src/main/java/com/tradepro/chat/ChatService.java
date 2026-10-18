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

        String prompt = buildPrompt(wallet, holdings, prices, question);
        return gemini.generate(prompt);
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
