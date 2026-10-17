package com.tradepro.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;

    @Value("${app.mail.from:no-reply@tradepro.local}")
    private String from;

    @Value("${app.mail.enabled:false}")
    private boolean mailEnabled;

    @Value("${app.frontend-url:http://localhost:5173}")
    private String frontendUrl;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendPasswordReset(String to, String token) {
        String resetLink = frontendUrl + "/forgot-password?token=" + token;
        String body = "You requested a password reset for your TradePro account.\n\n"
                + "Use this token to reset your password: " + token + "\n\n"
                + "Or open this link: " + resetLink + "\n\n"
                + "This token expires in 1 hour. If you didn't request this, ignore this email.";

        if (!mailEnabled) {
            // SMTP not configured: log so dev flow still works.
            log.info("[EMAIL DISABLED] Password reset for {} -> token: {}", to, token);
            return;
        }

        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(to);
            message.setSubject("Reset your TradePro password");
            message.setText(body);
            mailSender.send(message);
            log.info("Password reset email sent to {}", to);
        } catch (Exception ex) {
            log.error("Failed to send password reset email to {}: {}", to, ex.getMessage());
        }
    }

    public void sendAlertTriggered(String to, String symbol, String name,
                                   String direction, double target, double current) {
        if (!mailEnabled) {
            log.info("[EMAIL DISABLED] Alert triggered for {} -> {} {} target {} now {}",
                    to, symbol, direction, target, current);
            return;
        }

        String body = "Your TradePro price alert has triggered.\n\n"
                + "Stock: " + name + " (" + symbol + ")\n"
                + "Direction: " + direction + "\n"
                + "Target price: " + String.format(java.util.Locale.ENGLISH, "\u20b9%,.2f", target) + "\n"
                + "Current price: " + String.format(java.util.Locale.ENGLISH, "\u20b9%,.2f", current) + "\n\n"
                + "Log in to TradePro to review your alerts.";

        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(to);
            message.setSubject("TradePro price alert: " + symbol);
            message.setText(body);
            mailSender.send(message);
            log.info("Alert-triggered email sent to {}", to);
        } catch (Exception ex) {
            log.error("Failed to send alert-triggered email to {}: {}", to, ex.getMessage());
        }
    }

    public void sendFundsAdded(String to, double amount, double newBalance) {
        if (!mailEnabled) {
            log.info("[EMAIL DISABLED] Funds added for {} -> amount {} new balance {}",
                    to, amount, newBalance);
            return;
        }

        String body = "Your TradePro wallet has been credited.\n\n"
                + "Amount added: " + String.format(java.util.Locale.ENGLISH, "\u20b9%,.2f", amount) + "\n"
                + "New wallet balance: " + String.format(java.util.Locale.ENGLISH, "\u20b9%,.2f", newBalance) + "\n"
                + "Time: " + java.time.Instant.now() + "\n\n"
                + "If you didn't make this transaction, contact support.";

        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(to);
            message.setSubject("TradePro: funds added");
            message.setText(body);
            mailSender.send(message);
            log.info("Funds-added email sent to {}", to);
        } catch (Exception ex) {
            log.error("Failed to send funds-added email to {}: {}", to, ex.getMessage());
        }
    }
}
