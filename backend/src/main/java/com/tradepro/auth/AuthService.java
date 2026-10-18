package com.tradepro.auth;

import com.tradepro.auth.dto.AuthResponse;
import com.tradepro.auth.dto.LoginRequest;
import com.tradepro.auth.dto.RegisterRequest;
import com.tradepro.auth.dto.UserResponse;
import com.tradepro.user.UserAccount;
import com.tradepro.user.UserAccountRepository;
import com.tradepro.security.JwtService;
import com.tradepro.email.EmailService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.UUID;

@Service
public class AuthService {

    private final UserAccountRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final EmailService emailService;

    public AuthService(
            UserAccountRepository repository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            EmailService emailService) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.emailService = emailService;
    }

    public AuthResponse register(RegisterRequest request) {
        if (repository.existsByEmailIgnoreCase(request.getEmail())) {
            throw new AuthException("An account with this email already exists");
        }

        UserAccount account = new UserAccount();
        account.setFullName(request.getFullName());
        account.setEmail(request.getEmail().toLowerCase());
        account.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        account.setPhoneNumber(request.getPhoneNumber());
        account.setAddress(request.getAddress());
        account.setDateOfBirth(request.getDateOfBirth());
        account.setMembershipStatus("active");

        UserAccount saved = repository.save(account);
        return buildResponse(saved);
    }

    public AuthResponse login(LoginRequest request) {
        UserAccount account = repository
                .findByEmailIgnoreCase(request.getEmail())
                .orElseThrow(() -> new AuthException("Invalid email or password"));

        if (!passwordEncoder.matches(request.getPassword(), account.getPasswordHash())) {
            throw new AuthException("Invalid email or password");
        }

        return buildResponse(account);
    }

    public UserResponse currentUser(String userId) {
        UserAccount account = repository
                .findById(UUID.fromString(userId))
                .orElseThrow(() -> new AuthException("User not found"));
        return UserResponse.from(account);
    }

    // Generates a 6-digit OTP, stores its BCrypt hash with a 10-minute expiry,
    // and emails the raw code. The OTP is never surfaced to the caller. Unknown
    // emails are a silent no-op so account existence is not revealed.
    public void createPasswordResetOtp(String email) {
        repository.findByEmailIgnoreCase(email).ifPresent(account -> {
            String otp = generateOtp();
            account.setResetToken(passwordEncoder.encode(otp)); // store HASH of the OTP
            account.setResetTokenExpiry(Instant.now().plusSeconds(600)); // 10 minutes
            repository.save(account);
            emailService.sendPasswordResetOtp(account.getEmail(), otp);
        });
        // unknown email -> no-op
    }

    public void resetPassword(String email, String code, String newPassword) {
        if (newPassword == null || newPassword.length() < 8) {
            throw new AuthException("Password must be at least 8 characters");
        }
        UserAccount account = repository.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new AuthException("Invalid or expired code"));

        if (account.getResetTokenExpiry() == null
                || account.getResetTokenExpiry().isBefore(Instant.now())) {
            throw new AuthException("Invalid or expired code");
        }
        if (account.getResetToken() == null
                || !passwordEncoder.matches(code, account.getResetToken())) {
            throw new AuthException("Invalid or expired code");
        }

        account.setPasswordHash(passwordEncoder.encode(newPassword));
        account.setResetToken(null);
        account.setResetTokenExpiry(null);
        repository.save(account);
    }

    // 6-digit OTP with preserved leading zeros (always length 6, digits only).
    private String generateOtp() {
        int n = new SecureRandom().nextInt(1_000_000); // 0..999999
        return String.format("%06d", n);
    }

    private AuthResponse buildResponse(UserAccount account) {
        String token = jwtService.generateToken(
                account.getId().toString(), account.getEmail());
        return new AuthResponse(token, UserResponse.from(account));
    }
}
