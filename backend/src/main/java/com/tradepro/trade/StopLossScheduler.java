package com.tradepro.trade;

import com.tradepro.email.EmailService;
import com.tradepro.market.YahooFinanceClient;
import com.tradepro.user.UserAccountRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Periodically checks untriggered REAL stop-losses against live prices. When a
 * stop is hit and the user still holds the symbol, it auto-sells the full held
 * quantity via TradeService.sell and emails the owner. Batches distinct symbols
 * into a single market call, mirroring AlertScheduler. Paper stop-losses are
 * handled client-side (the scheduler cannot see localStorage paper holdings).
 */
@Component
public class StopLossScheduler {

    private static final Logger log = LoggerFactory.getLogger(StopLossScheduler.class);

    private final StopLossRepository repository;
    private final YahooFinanceClient marketClient;
    private final TradeService tradeService;
    private final EmailService emailService;
    private final UserAccountRepository userRepository;

    public StopLossScheduler(StopLossRepository repository, YahooFinanceClient marketClient,
                             TradeService tradeService, EmailService emailService,
                             UserAccountRepository userRepository) {
        this.repository = repository;
        this.marketClient = marketClient;
        this.tradeService = tradeService;
        this.emailService = emailService;
        this.userRepository = userRepository;
    }

    @Scheduled(fixedDelayString = "${app.stoploss.check-interval-ms:60000}")
    public void checkStopLosses() {
        if (!marketClient.isConfigured()) return;

        List<StopLoss> pending = repository.findAll().stream()
                .filter(s -> !s.isTriggered())
                .toList();
        if (pending.isEmpty()) return;

        List<String> symbols = pending.stream()
                .map(StopLoss::getSymbol)
                .distinct()
                .toList();

        Map<String, Double> prices = marketClient.getPrices(symbols);
        if (prices.isEmpty()) return;

        for (StopLoss stop : pending) {
            try {
                Double price = prices.get(stop.getSymbol());
                if (price == null) continue;
                if (price > stop.getStopPrice()) continue;

                // Only act if the user still holds the symbol.
                int heldQty = tradeService.getHoldings(stop.getUserId()).stream()
                        .filter(h -> h.getSymbol().equals(stop.getSymbol()))
                        .mapToInt(Holding::getQuantity)
                        .findFirst()
                        .orElse(0);
                if (heldQty <= 0) {
                    // Nothing to sell; mark triggered so it doesn't keep polling.
                    stop.setTriggered(true);
                    repository.save(stop);
                    continue;
                }

                tradeService.sell(stop.getUserId(), stop.getSymbol(), price, heldQty);
                stop.setTriggered(true);
                repository.save(stop);
                log.info("Stop-loss triggered: sold {} x {} at {} (stop {})",
                        heldQty, stop.getSymbol(), price, stop.getStopPrice());

                final double current = price;
                userRepository.findById(stop.getUserId()).ifPresent(u ->
                        emailService.sendAlertTriggered(u.getEmail(), stop.getSymbol(),
                                stop.getName(), "BELOW", stop.getStopPrice(), current));
            } catch (Exception ex) {
                log.warn("Stop-loss check failed for {}: {}", stop.getSymbol(), ex.getMessage());
            }
        }
    }
}
