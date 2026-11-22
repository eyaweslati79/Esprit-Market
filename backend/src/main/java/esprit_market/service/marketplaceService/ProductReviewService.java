package esprit_market.service.marketplaceService;

import esprit_market.dto.marketplace.ProductReviewDTO;
import esprit_market.entity.cart.OrderItem;
import esprit_market.entity.marketplace.Product;
import esprit_market.entity.marketplace.ProductReview;
import esprit_market.entity.marketplace.Shop;
import esprit_market.entity.user.User;
import esprit_market.repository.cartRepository.OrderItemRepository;
import esprit_market.repository.marketplaceRepository.ProductRepository;
import esprit_market.repository.marketplaceRepository.ProductReviewRepository;
import esprit_market.repository.marketplaceRepository.ShopRepository;
import esprit_market.repository.userRepository.UserRepository;
import esprit_market.service.userService.TrustService;
import esprit_market.utils.BadWordFilter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.types.ObjectId;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Service for managing product reviews
 * Integrates with Trust & Reputation System
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProductReviewService {
    
    private final ProductReviewRepository reviewRepository;
    private final ProductRepository productRepository;
    private final ShopRepository shopRepository;
    private final UserRepository userRepository;
    private final OrderItemRepository orderItemRepository;
    private final esprit_market.repository.cartRepository.OrderRepository orderRepository;
    private final TrustService trustService;
    
    /**
     * Create a new product review — works for any authenticated user.
     * If the user has a matching order item, the review is marked as verified.
     */
    @Transactional
    public ProductReviewDTO createReview(ProductReviewDTO dto) {
        ObjectId customerId = new ObjectId(dto.getCustomerId());
        ObjectId productId  = new ObjectId(dto.getProductId());

        // Prevent duplicate reviews per product per customer
        if (reviewRepository.existsByCustomerIdAndProductId(customerId, productId)) {
            throw new IllegalStateException("You have already reviewed this product");
        }

        Product product = productRepository.findById(productId)
                .orElseThrow(() -> new IllegalArgumentException("Product not found"));

        Shop shop = shopRepository.findById(product.getShopId())
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));

        // Determine if this is a verified purchase
        boolean verified = false;
        ObjectId orderItemId = null;
        if (dto.getOrderItemId() != null && !dto.getOrderItemId().isBlank()) {
            try {
                orderItemId = new ObjectId(dto.getOrderItemId());
                verified = orderItemRepository.findById(orderItemId).isPresent();
            } catch (Exception ignored) {}
        }

        ProductReview review = ProductReview.builder()
                .productId(productId)
                .shopId(shop.getId())
                .sellerId(shop.getOwnerId())
                .customerId(customerId)
                .orderItemId(orderItemId)
                .rating(dto.getRating())
                .comment(BadWordFilter.filter(dto.getComment()))
                .createdAt(LocalDateTime.now())
                .verified(verified)
                .approved(true)
                .build();

        ProductReview saved = reviewRepository.save(review);
        trustService.onProductReviewed(saved.getId());

        log.info("Review created for product {} by customer {}, rating: {}, verified: {}",
                productId, customerId, dto.getRating(), verified);

        return toDTO(saved);
    }
    
    /**
     * Get all reviews for a product
     */
    public List<ProductReviewDTO> getProductReviews(String productId) {
        ObjectId id = new ObjectId(productId);
        return reviewRepository.findByProductId(id).stream()
                .filter(ProductReview::isApproved)
                .map(this::toDTO)
                .collect(Collectors.toList());
    }
    
    /**
     * Get order items for the current user that are eligible to review for a given product
     * (purchased but not yet reviewed)
     */
    public List<java.util.Map<String, String>> getReviewableOrderItems(String productId) {
        ObjectId productObjId = new ObjectId(productId);

        // Get current user
        org.springframework.security.core.Authentication auth =
                org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getName() == null) return java.util.Collections.emptyList();

        User user = userRepository.findByEmail(auth.getName()).orElse(null);
        if (user == null) return java.util.Collections.emptyList();

        // Find all order items for this product
        List<OrderItem> items = orderItemRepository.findByProductId(productObjId);

        // Filter: belongs to this user's orders AND not yet reviewed
        return items.stream()
                .filter(item -> {
                    // Check order belongs to user
                    return orderRepository.findById(item.getOrderId())
                            .map(order -> order.getUser() != null &&
                                    order.getUser().getId().equals(user.getId()))
                            .orElse(false);
                })
                .filter(item -> !reviewRepository.existsByCustomerIdAndOrderItemId(user.getId(), item.getId()))
                .map(item -> {
                    java.util.Map<String, String> m = new java.util.HashMap<>();
                    m.put("orderItemId", item.getId().toHexString());
                    m.put("productName", item.getProductName());
                    return m;
                })
                .collect(Collectors.toList());
    }

    /**
     * Get all reviews for a seller
     */
    public List<ProductReviewDTO> getSellerReviews(String sellerId) {
        ObjectId id = new ObjectId(sellerId);
        return reviewRepository.findBySellerId(id).stream()
                .filter(ProductReview::isApproved)
                .map(this::toDTO)
                .collect(Collectors.toList());
    }
    
    /**
     * Convert entity to DTO
     */
    private ProductReviewDTO toDTO(ProductReview review) {
        ProductReviewDTO dto = new ProductReviewDTO();
        dto.setId(review.getId().toHexString());
        dto.setProductId(review.getProductId().toHexString());
        dto.setShopId(review.getShopId().toHexString());
        dto.setSellerId(review.getSellerId().toHexString());
        dto.setCustomerId(review.getCustomerId().toHexString());
        dto.setOrderItemId(review.getOrderItemId().toHexString());
        dto.setRating(review.getRating());
        dto.setComment(review.getComment());
        dto.setCreatedAt(review.getCreatedAt());
        dto.setVerified(review.isVerified());
        dto.setApproved(review.isApproved());
        
        // Enrich with product name
        productRepository.findById(review.getProductId()).ifPresent(product -> {
            dto.setProductName(product.getName());
        });
        
        // Enrich with customer name
        userRepository.findById(review.getCustomerId()).ifPresent(user -> {
            dto.setCustomerName(user.getFirstName() + " " + user.getLastName());
        });
        
        return dto;
    }
}
