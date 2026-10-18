package com.tradepro.user;

import com.tradepro.auth.AuthException;
import com.tradepro.auth.dto.UserResponse;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.Period;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {

    private final UserAccountRepository repository;

    public ProfileController(UserAccountRepository repository) {
        this.repository = repository;
    }

    public record ThemeRequest(String theme) {}

    public record UpdateProfileRequest(
            String fullName,
            @Pattern(regexp = "\\d{10}", message = "Phone number must be exactly 10 digits")
            String phoneNumber,
            String address,
            String dateOfBirth) {}

    @PutMapping
    public ResponseEntity<UserResponse> update(
            Authentication auth, @RequestBody UpdateProfileRequest req) {
        UserAccount user = repository.findById(UUID.fromString(auth.getName()))
                .orElseThrow(() -> new AuthException("User not found"));
        // fullName: keep existing behavior (set only when present and non-blank)
        if (req.fullName() != null && !req.fullName().isBlank()) {
            user.setFullName(req.fullName());
        }
        // phoneNumber (R4.1, R4.2): validate explicitly so the message is deterministic
        if (req.phoneNumber() != null) {
            if (!req.phoneNumber().matches("\\d{10}")) {
                throw new AuthException("Phone number must be exactly 10 digits");
            }
            user.setPhoneNumber(req.phoneNumber());
        }
        // address (R4.6): non-empty after trim, <=200 chars, no control characters
        if (req.address() != null) {
            String trimmed = req.address().trim();
            boolean hasControl = trimmed.chars().anyMatch(c -> c < 0x20 || c == 0x7F);
            if (trimmed.isEmpty() || trimmed.length() > 200 || hasControl) {
                throw new AuthException(
                        "Address must be non-empty, at most 200 characters, and free of control characters");
            }
            user.setAddress(trimmed);
        }
        // dateOfBirth (R4.3, R4.4, R4.5): strict ISO parse + age / range checks
        if (req.dateOfBirth() != null && !req.dateOfBirth().isBlank()) {
            LocalDate dob;
            try {
                dob = LocalDate.parse(req.dateOfBirth()); // strict ISO yyyy-MM-dd
            } catch (DateTimeParseException ex) {
                throw new AuthException("Date of birth is not a valid date");
            }
            LocalDate today = LocalDate.now();
            if (dob.isAfter(today)) {
                throw new AuthException("Date of birth cannot be in the future");
            }
            if (dob.isBefore(LocalDate.of(1900, 1, 1))
                    || Period.between(dob, today).getYears() < 18) {
                throw new AuthException(
                        "You must be at least 18 years old and born on or after 1 Jan 1900");
            }
            user.setDateOfBirth(req.dateOfBirth());
        }
        repository.save(user);
        return ResponseEntity.ok(UserResponse.from(user));
    }

    @PutMapping("/theme")
    public ResponseEntity<Map<String, String>> setTheme(
            Authentication auth, @RequestBody ThemeRequest req) {
        String theme = "light".equalsIgnoreCase(req.theme()) ? "light" : "dark";
        UserAccount user = repository.findById(UUID.fromString(auth.getName()))
                .orElseThrow(() -> new AuthException("User not found"));
        user.setTheme(theme);
        repository.save(user);
        return ResponseEntity.ok(Map.of("theme", theme));
    }
}
