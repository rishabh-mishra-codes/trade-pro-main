package com.tradepro.trade;

import com.tradepro.auth.AuthException;
import com.tradepro.auth.dto.UserResponse;
import com.tradepro.email.EmailService;
import com.tradepro.user.UserAccount;
import com.tradepro.user.UserAccountRepository;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class TradeController {

    private final TradeService tradeService;
    private final OrderHistoryPdfService pdfService;
    private final EmailService emailService;
    private final UserAccountRepository userRepository;

    public TradeController(TradeService tradeService,
                           OrderHistoryPdfService pdfService,
                           EmailService emailService,
                           UserAccountRepository userRepository) {
        this.tradeService = tradeService;
        this.pdfService = pdfService;
        this.emailService = emailService;
        this.userRepository = userRepository;
    }

    public record TradeRequest(String symbol, String name, double price, int qty) {}
    public record FundsRequest(double amount) {}
    public record LimitOrderRequest(String symbol, String name, String side, double price, int qty) {}

    @GetMapping("/portfolio")
    public ResponseEntity<Map<String, Object>> portfolio(Authentication auth) {
        UUID userId = UUID.fromString(auth.getName());
        List<Holding> holdings = tradeService.getHoldings(userId);
        return ResponseEntity.ok(Map.of(
                "wallet", tradeService.getWallet(userId),
                "holdings", holdings));
    }

    @GetMapping("/orders")
    public ResponseEntity<List<OrderRecord>> orders(Authentication auth) {
        return ResponseEntity.ok(tradeService.getOrders(UUID.fromString(auth.getName())));
    }

    @GetMapping("/orders/history/pdf")
    public ResponseEntity<byte[]> orderHistoryPdf(Authentication auth) {
        UUID userId = UUID.fromString(auth.getName());
        UserAccount user = userRepository.findById(userId)
                .orElseThrow(() -> new AuthException("User not found"));
        List<OrderRecord> orders = tradeService.getOrders(userId);
        byte[] pdf = pdfService.build(UserResponse.from(user), orders);
        emailService.sendOrderHistory(user.getEmail(), pdf);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(
                ContentDisposition.attachment().filename("tradepro-orders.pdf").build());
        return new ResponseEntity<>(pdf, headers, HttpStatus.OK);
    }

    @PostMapping("/orders/limit")
    public ResponseEntity<OrderRecord> limitOrder(
            Authentication auth, @RequestBody LimitOrderRequest req) {
        UUID userId = UUID.fromString(auth.getName());
        OrderRecord.Side side = "SELL".equalsIgnoreCase(req.side())
                ? OrderRecord.Side.SELL : OrderRecord.Side.BUY;
        return ResponseEntity.ok(tradeService.placeLimitOrder(
                userId, req.symbol(), req.name(), side, req.price(), req.qty()));
    }

    @DeleteMapping("/orders/{id}")
    public ResponseEntity<Map<String, String>> cancelOrder(
            Authentication auth, @PathVariable UUID id) {
        tradeService.cancelOrder(UUID.fromString(auth.getName()), id);
        return ResponseEntity.ok(Map.of("message", "Order cancelled"));
    }

    @PostMapping("/trades/buy")
    public ResponseEntity<Map<String, String>> buy(
            Authentication auth, @RequestBody TradeRequest req) {
        UUID userId = UUID.fromString(auth.getName());
        tradeService.buy(userId, req.symbol(), req.name(), req.price(), req.qty());
        return ResponseEntity.ok(Map.of("message", "Buy order executed"));
    }

    @PostMapping("/trades/sell")
    public ResponseEntity<Map<String, String>> sell(
            Authentication auth, @RequestBody TradeRequest req) {
        UUID userId = UUID.fromString(auth.getName());
        tradeService.sell(userId, req.symbol(), req.price(), req.qty());
        return ResponseEntity.ok(Map.of("message", "Sell order executed"));
    }

    @PostMapping("/wallet/add-funds")
    public ResponseEntity<Map<String, Object>> addFunds(
            Authentication auth, @RequestBody FundsRequest req) {
        UUID userId = UUID.fromString(auth.getName());
        double balance = tradeService.addFunds(userId, req.amount());
        return ResponseEntity.ok(Map.of("wallet", balance));
    }
}
