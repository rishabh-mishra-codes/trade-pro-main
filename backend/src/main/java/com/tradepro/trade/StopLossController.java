package com.tradepro.trade;

import com.tradepro.auth.AuthException;
import com.tradepro.market.StockUniverse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/stoploss")
public class StopLossController {

    private final StopLossRepository repository;

    public StopLossController(StopLossRepository repository) {
        this.repository = repository;
    }

    public record CreateRequest(String symbol, String name, double stopPrice) {}

    @GetMapping
    public List<StopLoss> list(Authentication auth) {
        return repository.findByUserIdOrderByCreatedAtDesc(UUID.fromString(auth.getName()));
    }

    @PostMapping
    public ResponseEntity<StopLoss> create(Authentication auth, @RequestBody CreateRequest req) {
        if (req.stopPrice() <= 0) throw new AuthException("Stop price must be positive");

        StopLoss stop = new StopLoss();
        stop.setUserId(UUID.fromString(auth.getName()));
        stop.setSymbol(req.symbol());
        stop.setName(req.name() != null ? req.name() : StockUniverse.nameFor(req.symbol()));
        stop.setStopPrice(req.stopPrice());
        return ResponseEntity.ok(repository.save(stop));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(Authentication auth, @PathVariable UUID id) {
        UUID userId = UUID.fromString(auth.getName());
        repository.findById(id)
                .filter(s -> s.getUserId().equals(userId))
                .ifPresent(repository::delete);
        return ResponseEntity.ok(Map.of("message", "deleted"));
    }
}
