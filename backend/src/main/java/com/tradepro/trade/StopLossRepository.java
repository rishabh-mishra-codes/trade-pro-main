package com.tradepro.trade;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface StopLossRepository extends JpaRepository<StopLoss, UUID> {

    List<StopLoss> findByUserIdOrderByCreatedAtDesc(UUID userId);
}
