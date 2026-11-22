package esprit_market.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * Configuration for the Marketplace ML Service (port 8003).
 *
 * This service runs the collaborative-filtering recommendation engine
 * from marketplace-ml/ and exposes /predict, /predict/batch, /recommend,
 * /feedback and /health endpoints.
 *
 * Separate from the Cart ML service (port 8002) which handles cart-level
 * price/promo suggestions.
 */
@Configuration
@ConfigurationProperties(prefix = "app.marketplace-ml")
@Data
public class MarketplaceMLConfig {

    private String baseUrl = "http://localhost:8003";
    private int timeoutSeconds = 10;
    private boolean enabled = true;

    @Bean("marketplaceMLWebClient")
    public WebClient marketplaceMLWebClient() {
        return WebClient.builder()
                .baseUrl(baseUrl)
                .codecs(c -> c.defaultCodecs().maxInMemorySize(512 * 1024))
                .build();
    }
}
