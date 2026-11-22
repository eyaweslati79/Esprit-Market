package esprit_market.config;

import esprit_market.service.negociationService.INegociationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * On startup, backfills AI acceptance probability for any existing negotiations
 * that were created before the AI feature was added.
 * Runs asynchronously so it never delays application startup.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NegotiationAiBackfillRunner implements ApplicationRunner {

    private final INegociationService negociationService;

    @Override
    public void run(ApplicationArguments args) {
        new Thread(() -> {
            try {
                // Small delay to let the ML service finish starting up
                Thread.sleep(15_000);
                log.info("[AI Backfill] Starting negotiation AI probability backfill...");
                int updated = negociationService.backfillAiProbabilities();
                log.info("[AI Backfill] Done — updated {} negotiations", updated);
            } catch (Exception e) {
                log.warn("[AI Backfill] Failed (non-critical): {}", e.getMessage());
            }
        }, "neg-ai-backfill").start();
    }
}
