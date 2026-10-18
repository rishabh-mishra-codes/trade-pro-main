package com.tradepro.auth;

import com.tradepro.auth.dto.AuthResponse;
import com.tradepro.auth.dto.ForgotPasswordRequest;
import com.tradepro.auth.dto.LoginRequest;
import com.tradepro.auth.dto.RegisterRequest;
import com.tradepro.auth.dto.ResetPasswordRequest;
import com.tradepro.auth.dto.UserResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(
            @Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.ok(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
            @Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> me(Authentication authentication) {
        String userId = authentication.getName();
        return ResponseEntity.ok(authService.currentUser(userId));
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<Map<String, String>> forgotPassword(
            @Valid @RequestBody ForgotPasswordRequest request) {
        authService.createPasswordResetOtp(request.getEmail());
        // The response contains ONLY a generic acknowledgement — never the code.
        // The 6-digit OTP is emailed to the registered address by AuthService.
        return ResponseEntity.ok(Map.of(
                "message", "If that email exists, a reset code has been sent."));
    }

    @PostMapping("/reset-password")
    public ResponseEntity<Map<String, String>> resetPassword(
            @Valid @RequestBody ResetPasswordRequest request) {
        authService.resetPassword(
                request.getEmail(), request.getCode(), request.getNewPassword());
        return ResponseEntity.ok(Map.of("message", "Password has been reset"));
    }
}
