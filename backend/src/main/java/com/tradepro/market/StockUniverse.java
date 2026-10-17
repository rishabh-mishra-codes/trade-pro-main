package com.tradepro.market;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Static list of popular NSE symbols for search. In a real app this would come
 * from an exchange master API; kept static here to avoid extra API calls.
 */
public final class StockUniverse {

    public record Stock(String symbol, String name) {}

    public static final List<Stock> ALL = List.of(
            new Stock("RELIANCE", "Reliance Industries"),
            new Stock("TCS", "Tata Consultancy Services"),
            new Stock("INFY", "Infosys"),
            new Stock("HDFCBANK", "HDFC Bank"),
            new Stock("ICICIBANK", "ICICI Bank"),
            new Stock("SBIN", "State Bank of India"),
            new Stock("TATAMOTORS", "Tata Motors"),
            new Stock("WIPRO", "Wipro"),
            new Stock("HINDUNILVR", "Hindustan Unilever"),
            new Stock("ITC", "ITC"),
            new Stock("BHARTIARTL", "Bharti Airtel"),
            new Stock("KOTAKBANK", "Kotak Mahindra Bank"),
            new Stock("LT", "Larsen & Toubro"),
            new Stock("AXISBANK", "Axis Bank"),
            new Stock("BAJFINANCE", "Bajaj Finance"),
            new Stock("MARUTI", "Maruti Suzuki"),
            new Stock("ASIANPAINT", "Asian Paints"),
            new Stock("HCLTECH", "HCL Technologies"),
            new Stock("SUNPHARMA", "Sun Pharma"),
            new Stock("TITAN", "Titan Company"),
            new Stock("ULTRACEMCO", "UltraTech Cement"),
            new Stock("NESTLEIND", "Nestle India"),
            new Stock("ADANIENT", "Adani Enterprises"),
            new Stock("POWERGRID", "Power Grid"),
            new Stock("NTPC", "NTPC"),
            new Stock("ONGC", "ONGC"),
            new Stock("TATASTEEL", "Tata Steel"),
            new Stock("JSWSTEEL", "JSW Steel"),
            new Stock("COALINDIA", "Coal India")
    );

    private static final Map<String, Stock> BY_SYMBOL =
            ALL.stream().collect(Collectors.toMap(Stock::symbol, s -> s, (a, b) -> a));

    public static List<Stock> search(String query, int limit) {
        if (query == null || query.isBlank()) {
            return ALL.stream().limit(limit).toList();
        }
        String q = query.toLowerCase();
        return ALL.stream()
                .filter(s -> s.symbol().toLowerCase().contains(q)
                        || s.name().toLowerCase().contains(q))
                .limit(limit)
                .toList();
    }

    public static String nameFor(String symbol) {
        Stock s = BY_SYMBOL.get(symbol);
        return s != null ? s.name() : symbol;
    }

    private StockUniverse() {}
}
