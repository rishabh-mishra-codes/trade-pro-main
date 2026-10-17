package com.tradepro.market;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Free server-side market data client backed by Yahoo Finance's public chart
 * endpoint. Used because the free Twelve Data plan does not serve NSE symbols.
 * Yahoo blocks browser CORS and expects a browser User-Agent, so all calls are
 * proxied through the backend. No API key is required.
 *
 * Symbol convention: the rest of the app uses bare NSE tickers (RELIANCE, TCS,
 * INFY). This client appends ".NS" when calling Yahoo, maps index aliases like
 * NIFTY to ^NSEI, and leaves symbols that already carry a '^' prefix or a '.'
 * suffix untouched.
 */
@Component
public class YahooFinanceClient {

    private static final Logger log = LoggerFactory.getLogger(YahooFinanceClient.class);
    private static final String CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Index / alias tickers that don't follow the "<SYM>.NS" pattern.
    private static final Map<String, String> ALIASES = Map.of(
            "NIFTY", "^NSEI",
            "NIFTY50", "^NSEI",
            "BANKNIFTY", "^NSEBANK",
            "SENSEX", "^BSESN"
    );

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();

    /** No API key needed for the public Yahoo endpoint. */
    public boolean isConfigured() {
        return true;
    }

    /** Quote shape returned to the frontend (bare symbol). */
    public record QuoteDto(
            String symbol,
            String name,
            double price,
            double previousClose,
            double change,
            double percent) {}

    /** Single OHLC candle; time is epoch seconds. */
    public record CandleDto(
            long time,
            double open,
            double high,
            double low,
            double close) {}

    /** Maps a bare ticker to the symbol Yahoo expects. */
    private String yahooSymbol(String bare) {
        if (bare == null || bare.isBlank()) return bare;
        String s = bare.trim();
        String alias = ALIASES.get(s.toUpperCase());
        if (alias != null) return alias;
        if (s.startsWith("^") || s.contains(".")) return s;
        return s + ".NS";
    }

    /** Fetches the chart JSON for a Yahoo symbol, or null on any failure. */
    private JsonNode fetchChart(String yahooSym, String interval, String range) {
        try {
            String url = CHART
                    + URLEncoder.encode(yahooSym, StandardCharsets.UTF_8)
                    + "?interval=" + interval + "&range=" + range;
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("User-Agent", USER_AGENT)
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                log.debug("Yahoo returned {} for {}", res.statusCode(), yahooSym);
                return null;
            }
            JsonNode result = mapper.readTree(res.body()).at("/chart/result/0");
            return result.isMissingNode() ? null : result;
        } catch (Exception ex) {
            log.debug("Yahoo fetch failed for {}: {}", yahooSym, ex.getMessage());
            return null;
        }
    }

    /** Returns bareSymbol -> last price. Best-effort; skips failures. */
    public Map<String, Double> getPrices(List<String> bareSymbols) {
        Map<String, Double> out = new HashMap<>();
        if (bareSymbols == null || bareSymbols.isEmpty()) return out;

        for (String bare : bareSymbols) {
            JsonNode result = fetchChart(yahooSymbol(bare), "1d", "1d");
            if (result == null) continue;
            JsonNode price = result.at("/meta/regularMarketPrice");
            if (price.isNumber()) {
                out.put(bare, price.asDouble());
            }
        }
        return out;
    }

    /** Single quote for a bare symbol, or null if unavailable. */
    public QuoteDto getQuote(String bare) {
        JsonNode result = fetchChart(yahooSymbol(bare), "1d", "1d");
        if (result == null) return null;

        JsonNode meta = result.at("/meta");
        JsonNode priceNode = meta.at("/regularMarketPrice");
        if (!priceNode.isNumber()) return null;

        double price = priceNode.asDouble();
        JsonNode prevNode = meta.at("/previousClose");
        if (!prevNode.isNumber()) prevNode = meta.at("/chartPreviousClose");
        double previousClose = prevNode.isNumber() ? prevNode.asDouble() : 0.0;

        double change = previousClose != 0.0 ? price - previousClose : 0.0;
        double percent = previousClose != 0.0 ? (change / previousClose) * 100.0 : 0.0;

        return new QuoteDto(bare, null, price, previousClose, change, percent);
    }

    /**
     * Intraday/historical candles for a bare symbol. uiInterval is one of the
     * frontend chart buttons (5min, 15min, 1h, 1day); it is mapped to a Yahoo
     * interval + range pair. Rows with any null OHLC value are skipped.
     */
    public List<CandleDto> getCandles(String bare, String uiInterval) {
        String yInterval;
        String yRange;
        switch (uiInterval == null ? "" : uiInterval) {
            case "5min" -> { yInterval = "5m"; yRange = "1d"; }
            case "15min" -> { yInterval = "15m"; yRange = "5d"; }
            case "1h" -> { yInterval = "60m"; yRange = "1mo"; }
            case "1day" -> { yInterval = "1d"; yRange = "3mo"; }
            default -> { yInterval = "15m"; yRange = "5d"; }
        }

        List<CandleDto> out = new ArrayList<>();
        JsonNode result = fetchChart(yahooSymbol(bare), yInterval, yRange);
        if (result == null) return out;

        JsonNode timestamps = result.at("/timestamp");
        JsonNode quote = result.at("/indicators/quote/0");
        if (!timestamps.isArray() || quote.isMissingNode()) return out;

        JsonNode opens = quote.at("/open");
        JsonNode highs = quote.at("/high");
        JsonNode lows = quote.at("/low");
        JsonNode closes = quote.at("/close");

        for (int i = 0; i < timestamps.size(); i++) {
            JsonNode o = opens.get(i);
            JsonNode h = highs.get(i);
            JsonNode l = lows.get(i);
            JsonNode c = closes.get(i);
            if (o == null || o.isNull() || h == null || h.isNull()
                    || l == null || l.isNull() || c == null || c.isNull()) {
                continue;
            }
            out.add(new CandleDto(
                    timestamps.get(i).asLong(),
                    o.asDouble(), h.asDouble(), l.asDouble(), c.asDouble()));
        }
        return out;
    }
}
