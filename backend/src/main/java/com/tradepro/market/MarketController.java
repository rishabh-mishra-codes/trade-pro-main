package com.tradepro.market;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/market")
public class MarketController {

    private final YahooFinanceClient yahoo;

    public MarketController(YahooFinanceClient yahoo) {
        this.yahoo = yahoo;
    }

    // Stock search over the static NSE universe. Fast, no external call.
    @GetMapping("/search")
    public List<StockUniverse.Stock> search(
            @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "10") int limit) {
        return StockUniverse.search(q, Math.min(limit, 30));
    }

    // Single live quote for a bare NSE symbol (e.g. RELIANCE).
    @GetMapping("/quote")
    public YahooFinanceClient.QuoteDto quote(@RequestParam String symbol) {
        return withName(yahoo.getQuote(symbol));
    }

    // Batch live quotes. symbols is a comma-separated list of bare tickers.
    @GetMapping("/quotes")
    public List<YahooFinanceClient.QuoteDto> quotes(@RequestParam String symbols) {
        List<YahooFinanceClient.QuoteDto> out = new ArrayList<>();
        for (String raw : symbols.split(",")) {
            String symbol = raw.trim();
            if (symbol.isEmpty()) continue;
            YahooFinanceClient.QuoteDto quote = withName(yahoo.getQuote(symbol));
            if (quote != null) out.add(quote);
        }
        return out;
    }

    // Intraday/historical candles for a bare symbol. interval: 5min|15min|1h|1day.
    @GetMapping("/candles")
    public List<YahooFinanceClient.CandleDto> candles(
            @RequestParam String symbol,
            @RequestParam(defaultValue = "15min") String interval) {
        return yahoo.getCandles(symbol, interval);
    }

    // Attaches the human-readable name from the static universe to a quote.
    private YahooFinanceClient.QuoteDto withName(YahooFinanceClient.QuoteDto q) {
        if (q == null) return null;
        return new YahooFinanceClient.QuoteDto(
                q.symbol(),
                StockUniverse.nameFor(q.symbol()),
                q.price(),
                q.previousClose(),
                q.change(),
                q.percent());
    }
}
