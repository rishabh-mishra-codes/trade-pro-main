package com.tradepro.user;

import com.tradepro.auth.AuthException;
import com.tradepro.auth.dto.UserResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

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
            String fullName, String phoneNumber, String address, String dateOfBirth) {}

    @PutMapping
    public ResponseEntity<UserResponse> update(
            Authentication auth, @RequestBody UpdateProfileRequest req) {
        UserAccount user = repository.findById(UUID.fromString(auth.getName()))
                .orElseThrow(() -> new AuthException("User not found"));
        if (req.fullName() != null && !req.fullName().isBlank()) {
            user.setFullName(req.fullName());
        }
        if (req.phoneNumber() != null) {
            user.setPhoneNumber(req.phoneNumber());
        }
        if (req.address() != null) {
            user.setAddress(req.address());
        }
        if (req.dateOfBirth() != null) {
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
