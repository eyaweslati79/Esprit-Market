package esprit_market.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;


@Component
@RequiredArgsConstructor
@Slf4j
public class RecommendationIntegrationExample {

    private final RecommendationIntegrationService recommendationIntegration;


    public void exampleFavorisIntegration(String userId, String productId) {
        // Your existing favoris logic here...
        
        // Add this line to track the like action
        recommendationIntegration.trackProductLike(userId, productId);
        
        log.info("Added to favorites and tracked ML feedback for user: {}, product: {}", userId, productId);
    }

    /**
     * Example: How to integrate with ProductService
     * Add this to your existing ProductService.getProductById() method
     */
    public void exampleProductViewIntegration(String userId, String productId) {
        // Your existing product retrieval logic here...
        
        // Add this line to track the view action
        recommendationIntegration.trackProductView(userId, productId);
        
        log.info("Product viewed and tracked ML feedback for user: {}, product: {}", userId, productId);
    }

    /**
     * Example: How to integrate with CartService
     * Add this to your existing CartService.addToCart() method
     */
    public void exampleAddToCartIntegration(String userId, String productId) {
        // Your existing add to cart logic here...
        
        // Add this line to track the add to cart action
        recommendationIntegration.trackAddToCart(userId, productId);
        
        log.info("Added to cart and tracked ML feedback for user: {}, product: {}", userId, productId);
    }

    /**
     * Example: How to integrate with CartService
     * Add this to your existing CartService.removeFromCart() method
     */
    public void exampleRemoveFromCartIntegration(String userId, String productId) {
        // Your existing remove from cart logic here...
        
        // Add this line to track the remove from cart action
        recommendationIntegration.trackRemoveFromCart(userId, productId);
        
        log.info("Removed from cart and tracked ML feedback for user: {}, product: {}", userId, productId);
    }

    /**
     * Example: How to integrate with OrderService
     * Add this to your existing OrderService.completeOrder() method
     */
    public void examplePurchaseIntegration(String userId, java.util.List<String> productIds) {
        // Your existing order completion logic here...
        
        // Add this line to track the purchase actions
        recommendationIntegration.trackMultiplePurchases(userId, productIds);
        
        log.info("Order completed and tracked ML feedback for user: {}, products: {}", userId, productIds.size());
    }
}

