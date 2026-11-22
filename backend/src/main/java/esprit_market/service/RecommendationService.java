package esprit_market.service;

import esprit_market.Enum.marketplaceEnum.ProductStatus;
import esprit_market.config.RecommendationConfig;
import esprit_market.dto.recommendation.FeedbackRequestDTO;
import esprit_market.dto.recommendation.FeedbackResponseDTO;
import esprit_market.dto.recommendation.ProductRecommendationDTO;
import esprit_market.dto.recommendation.RecommendationDTO;
import esprit_market.entity.cart.Cart;
import esprit_market.entity.cart.CartItem;
import esprit_market.entity.cart.Order;
import esprit_market.entity.cart.OrderItem;
import esprit_market.entity.marketplace.Category;
import esprit_market.entity.marketplace.Product;
import esprit_market.entity.user.User;
import esprit_market.repository.cartRepository.CartItemRepository;
import esprit_market.repository.cartRepository.CartRepository;
import esprit_market.repository.cartRepository.OrderItemRepository;
import esprit_market.repository.cartRepository.OrderRepository;
import esprit_market.entity.marketplace.Favoris;
import esprit_market.repository.marketplaceRepository.CategoryRepository;
import esprit_market.repository.marketplaceRepository.FavorisRepository;
import esprit_market.repository.marketplaceRepository.ProductRepository;
import esprit_market.repository.userRepository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.bson.types.ObjectId;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
/**
 * Recommendation service combining two layers:
 *
 *  Layer 1 — MongoDB-based personalization (PRIMARY, always works):
 *    Reads the user's purchase history (order_items) and cart history,
 *    derives category affinity, and scores every unseen approved product.
 *    Works from the very first purchase or cart action — no warm-up needed.
 *
 *  Layer 2 — ML microservice collaborative filtering (OPTIONAL boost):
 *    When the ML service is available and has interaction data for this user,
 *    its scores are blended in to re-rank the MongoDB candidates.
 *    If the ML service is down or cold, Layer 1 results are used as-is.
 */
@Service
@Slf4j
public class RecommendationService {

    private final WebClient webClient;
    private final RecommendationConfig config;
    private final MockRecommendationService mockService;
    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;
    private final UserRepository userRepository;
    private final OrderRepository orderRepository;
    private final OrderItemRepository orderItemRepository;
    private final CartRepository cartRepository;
    private final CartItemRepository cartItemRepository;
    private final FavorisRepository favorisRepository;

    public RecommendationService(
            @Qualifier("recommendationWebClient") WebClient webClient,
            RecommendationConfig config,
            MockRecommendationService mockService,
            ProductRepository productRepository,
            CategoryRepository categoryRepository,
            UserRepository userRepository,
            OrderRepository orderRepository,
            OrderItemRepository orderItemRepository,
            CartRepository cartRepository,
            CartItemRepository cartItemRepository,
            FavorisRepository favorisRepository) {
        this.webClient = webClient;
        this.config = config;
        this.mockService = mockService;
        this.productRepository = productRepository;
        this.categoryRepository = categoryRepository;
        this.userRepository = userRepository;
        this.orderRepository = orderRepository;
        this.orderItemRepository = orderItemRepository;
        this.cartRepository = cartRepository;
        this.cartItemRepository = cartItemRepository;
        this.favorisRepository = favorisRepository;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Map<String, String> buildCategoryNameMap() {
        return categoryRepository.findAll().stream()
                .collect(Collectors.toMap(
                        c -> c.getId().toHexString(),
                        Category::getName,
                        (a, b) -> a));
    }

    /**
     * Collect all product IDs the user has interacted with, weighted by signal strength:
     *   purchase  → 5.0  (completed orders — strongest intent)
     *   favorite  → 4.0  (wishlisted — strong interest)
     *   cart      → 3.5  (currently in cart — active intent)
     *   cart hist → 3.0  (past cart items — moderate interest)
     */
    private Map<String, Double> getUserInteractionScores(String userId) {
        Map<String, Double> scores = new LinkedHashMap<>();
        try {
            ObjectId uid = new ObjectId(userId);
            User user = userRepository.findById(uid).orElse(null);
            if (user == null) return scores;

            // ── Purchase history (weight 5.0) ─────────────────────────────────
            List<Order> orders = orderRepository.findByUser(user);
            if (!orders.isEmpty()) {
                List<ObjectId> orderIds = orders.stream().map(Order::getId).collect(Collectors.toList());
                for (OrderItem item : orderItemRepository.findByOrderIdIn(orderIds)) {
                    if (item.getProductId() != null) {
                        scores.merge(item.getProductId().toHexString(), 5.0, Double::sum);
                    }
                }
            }

            // ── Favorites / Wishlist (weight 4.0) ────────────────────────────
            List<Favoris> favorites = favorisRepository.findByUserId(uid);
            for (Favoris fav : favorites) {
                if (fav.getProductId() != null) {
                    scores.merge(fav.getProductId().toHexString(), 4.0, Double::sum);
                }
            }

            // ── Active cart items (weight 3.5) ────────────────────────────────
            List<Cart> carts = cartRepository.findByUserId(uid);
            if (!carts.isEmpty()) {
                List<ObjectId> cartIds = carts.stream().map(Cart::getId).collect(Collectors.toList());
                for (CartItem item : cartItemRepository.findByCartIdIn(cartIds)) {
                    if (item.getProductId() != null) {
                        scores.merge(item.getProductId().toHexString(), 3.5, Double::sum);
                    }
                }
            }

        } catch (Exception e) {
            log.warn("Could not load interaction history for user {}: {}", userId, e.getMessage());
        }
        return scores;
    }

    // ── Layer 1: MongoDB-based personalization ────────────────────────────────

    private RecommendationDTO buildPersonalizedFromMongo(String userId, int topK) {
        return buildPersonalizedFromMongo(userId, topK, null);
    }

    private RecommendationDTO buildPersonalizedFromMongo(String userId, int topK, String categoryFilter) {
        Map<String, String> catNames = buildCategoryNameMap();

        // All approved products
        List<Product> allApproved = productRepository.findByStatus(ProductStatus.APPROVED);
        if (allApproved.isEmpty()) {
            allApproved = productRepository.findAll();
        }

        final String catFilterLower = (categoryFilter != null && !categoryFilter.isBlank())
                ? categoryFilter.trim().toLowerCase() : null;

        Map<String, Product> productMap = allApproved.stream()
                .collect(Collectors.toMap(p -> p.getId().toHexString(), p -> p, (a, b) -> a));

        // User interaction history — used for category affinity, NOT for exclusion
        Map<String, Double> interactionScores = getUserInteractionScores(userId);

        // Category affinity: categoryId → cumulative score
        Map<String, Double> categoryAffinity = new LinkedHashMap<>();
        for (Map.Entry<String, Double> entry : interactionScores.entrySet()) {
            Product p = productMap.get(entry.getKey());
            if (p != null && p.getCategoryIds() != null) {
                for (ObjectId catId : p.getCategoryIds()) {
                    categoryAffinity.merge(catId.toHexString(), entry.getValue(), Double::sum);
                }
            }
        }

        boolean hasHistory = !interactionScores.isEmpty();
        log.info("User {} — hasHistory={}, affinity categories: {}, categoryFilter: {}",
                userId, hasHistory, categoryAffinity.size(), catFilterLower);

        // Score ALL in-stock approved products (no exclusion — diversity matters)
        Map<String, Double> candidateScores = new LinkedHashMap<>();
        for (Product p : allApproved) {
            String pid = p.getId().toHexString();
            if (p.getStock() <= 0) continue;

            // Category filter
            if (catFilterLower != null) {
                boolean matchesCategory = false;
                if (p.getCategoryIds() != null) {
                    for (ObjectId catId : p.getCategoryIds()) {
                        String catName = catNames.getOrDefault(catId.toHexString(), "").toLowerCase();
                        if (!catName.isEmpty() && (catName.contains(catFilterLower) || catFilterLower.contains(catName))) {
                            matchesCategory = true;
                            break;
                        }
                    }
                }
                if (!matchesCategory) continue;
            }

            double score = 0.0;

            // Category affinity (strongest signal)
            if (hasHistory && p.getCategoryIds() != null) {
                for (ObjectId catId : p.getCategoryIds()) {
                    score += categoryAffinity.getOrDefault(catId.toHexString(), 0.0) * 2.0;
                }
            }

            // Recency bonus — newer products get a boost
            if (p.getCreatedAt() != null) {
                long daysOld = ChronoUnit.DAYS.between(p.getCreatedAt(), java.time.LocalDateTime.now());
                score += Math.max(0, 60 - daysOld) * 0.15; // 60-day window
            }

            // Stock depth bonus
            score += Math.min(p.getStock(), 20) * 0.03;

            // Small random jitter for diversity — prevents identical ordering every request
            score += Math.random() * 0.5;

            // Slight penalty for already-purchased products (show them lower, not hidden)
            if (interactionScores.containsKey(pid)) {
                score *= 0.4;
            }

            candidateScores.put(pid, score);
        }

        // Rank by score
        List<Map.Entry<String, Double>> ranked = candidateScores.entrySet().stream()
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .limit(topK)
                .collect(Collectors.toList());

        // Cold-start fallback: newest approved products
        if (ranked.isEmpty()) {
            ranked = productMap.entrySet().stream()
                    .filter(e -> e.getValue().getStock() > 0)
                    .filter(e -> {
                        if (catFilterLower == null) return true;
                        Product p = e.getValue();
                        if (p.getCategoryIds() != null) {
                            for (ObjectId catId : p.getCategoryIds()) {
                                String catName = catNames.getOrDefault(catId.toHexString(), "").toLowerCase();
                                if (!catName.isEmpty() && (catName.contains(catFilterLower) || catFilterLower.contains(catName))) return true;
                            }
                        }
                        return false;
                    })
                    .sorted((a, b) -> {
                        if (a.getValue().getCreatedAt() == null) return 1;
                        if (b.getValue().getCreatedAt() == null) return -1;
                        return b.getValue().getCreatedAt().compareTo(a.getValue().getCreatedAt());
                    })
                    .limit(topK)
                    .map(e -> Map.entry(e.getKey(), 0.5))
                    .collect(Collectors.toList());
        }

        double maxScore = ranked.stream().mapToDouble(Map.Entry::getValue).max().orElse(1.0);

        List<ProductRecommendationDTO> recs = ranked.stream().map(entry -> {
            Product p = productMap.get(entry.getKey());
            if (p == null) return null;

            double normalised = maxScore > 0 ? Math.min(entry.getValue() / maxScore, 1.0) : 0.5;

            String catName = "";
            if (p.getCategoryIds() != null && !p.getCategoryIds().isEmpty()) {
                catName = catNames.getOrDefault(p.getCategoryIds().get(0).toHexString(), "");
            }

            boolean alreadyBought = interactionScores.containsKey(entry.getKey());

            String reason;
            if (!hasHistory) {
                reason = catFilterLower != null
                        ? "Popular in " + (catName.isEmpty() ? categoryFilter : catName)
                        : "Trending in the marketplace";
            } else if (alreadyBought) {
                reason = "You might want this again";
            } else if (p.getCategoryIds() != null && p.getCategoryIds().stream()
                    .anyMatch(c -> categoryAffinity.containsKey(c.toHexString()))) {
                reason = "Based on your interest in " + (catName.isEmpty() ? "this category" : catName);
            } else {
                reason = catFilterLower != null
                        ? "Similar to what you're viewing"
                        : "Popular in the marketplace";
            }

            String imageUrl = (p.getImages() != null && !p.getImages().isEmpty())
                    ? p.getImages().get(0).getUrl() : null;

            return ProductRecommendationDTO.builder()
                    .productId(entry.getKey())
                    .name(p.getName())
                    .price(p.getPrice())
                    .category(catName)
                    .imageUrl(imageUrl)
                    .inStock(p.getStock() > 0)
                    .isNegotiable(false)
                    .score(normalised)
                    .reason(reason)
                    .build();
        }).filter(Objects::nonNull).collect(Collectors.toList());

        String algo = hasHistory
                ? "purchase-history+favorites+cart+category-affinity+diversity"
                : "popularity+recency+diversity";

        return RecommendationDTO.builder()
                .userId(userId)
                .recommendations(recs)
                .totalCount(recs.size())
                .algorithmUsed(algo)
                .generatedAt(java.time.Instant.now().toString())
                .build();
    }

    // ── Layer 2: ML boost (optional) ─────────────────────────────────────────

    /**
     * Call the ML service's context-aware endpoints.
     *
     * context = "home"    → GET /recommend/home/{userId}
     * context = "product" → GET /recommend/product/{userId}?product_id={productId}
     * context = "cart"    → POST /recommend/cart  {user_id, cart_pids}
     * default             → GET /recommend/{userId}?category={category}
     */
    private RecommendationDTO tryMlEnrichment(RecommendationDTO mongoResult, String userId) {
        return tryMlEnrichment(mongoResult, userId, "generic", null, null);
    }

    private RecommendationDTO tryMlEnrichment(
            RecommendationDTO mongoResult,
            String userId,
            String context,
            String productId,
            List<String> cartPids) {

        if (!config.isEnabled()) return mongoResult;
        try {
            RecommendationDTO mlResult = null;

            switch (context) {
                case "home" -> mlResult = webClient
                        .get()
                        .uri("/recommend/home/{userId}?top_n=12", userId)
                        .retrieve()
                        .bodyToMono(RecommendationDTO.class)
                        .timeout(Duration.ofSeconds(5))
                        .onErrorReturn(null)
                        .block();

                case "product" -> {
                    if (productId != null && !productId.isBlank()) {
                        mlResult = webClient
                                .get()
                                .uri(u -> u.path("/recommend/product/{userId}")
                                        .queryParam("product_id", productId)
                                        .queryParam("top_n", 8)
                                        .build(userId))
                                .retrieve()
                                .bodyToMono(RecommendationDTO.class)
                                .timeout(Duration.ofSeconds(5))
                                .onErrorReturn(null)
                                .block();
                    }
                }

                case "cart" -> {
                    if (cartPids != null && !cartPids.isEmpty()) {
                        Map<String, Object> body = new java.util.HashMap<>();
                        body.put("user_id", userId);
                        body.put("cart_pids", cartPids);
                        body.put("top_n", 8);
                        mlResult = webClient
                                .post()
                                .uri("/recommend/cart")
                                .bodyValue(body)
                                .retrieve()
                                .bodyToMono(RecommendationDTO.class)
                                .timeout(Duration.ofSeconds(5))
                                .onErrorReturn(null)
                                .block();
                    }
                }

                default -> mlResult = webClient
                        .get()
                        .uri("/recommend/{userId}", userId)
                        .retrieve()
                        .bodyToMono(RecommendationDTO.class)
                        .timeout(Duration.ofSeconds(5))
                        .onErrorReturn(null)
                        .block();
            }

            if (mlResult == null || mlResult.getRecommendations() == null
                    || mlResult.getRecommendations().isEmpty()) {
                return mongoResult;
            }

            // Enrich ML results with real product data from MongoDB
            Map<String, String> catNames = buildCategoryNameMap();
            List<Product> allApproved = productRepository.findByStatus(ProductStatus.APPROVED);
            Map<String, Product> productMap = allApproved.stream()
                    .collect(Collectors.toMap(p -> p.getId().toHexString(), p -> p, (a, b) -> a));

            List<ProductRecommendationDTO> enriched = mlResult.getRecommendations().stream()
                    .map(rec -> {
                        Product p = productMap.get(rec.getProductId());
                        if (p == null) return null;

                        String catName = "";
                        if (p.getCategoryIds() != null && !p.getCategoryIds().isEmpty()) {
                            catName = catNames.getOrDefault(p.getCategoryIds().get(0).toHexString(), "");
                        }
                        String imageUrl = (p.getImages() != null && !p.getImages().isEmpty())
                                ? p.getImages().get(0).getUrl() : null;

                        return ProductRecommendationDTO.builder()
                                .productId(rec.getProductId())
                                .name(p.getName())
                                .price(p.getPrice())
                                .category(catName)
                                .imageUrl(imageUrl)
                                .inStock(p.getStock() > 0)
                                .isNegotiable(false)
                                .score(rec.getScore() != null ? rec.getScore() : 0.5)
                                .reason(rec.getReason() != null ? rec.getReason() : "Recommended for you")
                                .build();
                    })
                    .filter(Objects::nonNull)
                    .sorted(Comparator.comparingDouble(ProductRecommendationDTO::getScore).reversed())
                    .collect(Collectors.toList());

            if (enriched.isEmpty()) return mongoResult;

            RecommendationDTO result = RecommendationDTO.builder()
                    .userId(userId)
                    .recommendations(enriched)
                    .totalCount(enriched.size())
                    .algorithmUsed("shein-style-" + context + "+collaborative-filtering")
                    .generatedAt(java.time.Instant.now().toString())
                    .build();

            log.info("ML enrichment applied for user {} context={} → {} results", userId, context, enriched.size());
            return result;

        } catch (Exception e) {
            log.debug("ML enrichment skipped for user {} context={}: {}", userId, context, e.getMessage());
            return mongoResult;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public RecommendationDTO getRecommendations(String userId) {
        return getRecommendations(userId, null);
    }

    /** Generic / home-page recommendations — multi-category personalised feed. */
    public RecommendationDTO getRecommendations(String userId, String category) {
        log.info("Building recommendations for user: {} category: {}", userId, category);

        RecommendationDTO result = buildPersonalizedFromMongo(userId, 30, category);
        // Use "home" context when no category filter → multi-category feed
        result = tryMlEnrichment(result, userId, category == null ? "home" : "generic", null, null);

        if (result.getRecommendations().size() > 12) {
            result.setRecommendations(result.getRecommendations().subList(0, 12));
            result.setTotalCount(12);
        }

        log.info("Returning {} recommendations for user {} (algo: {})",
                result.getTotalCount(), userId, result.getAlgorithmUsed());
        return result;
    }

    /** Product-page recommendations — ONLY same category as the viewed product. */
    public RecommendationDTO getProductPageRecommendations(String userId, String productId) {
        log.info("Product-page recs for user: {} product: {}", userId, productId);

        // Resolve the category of the viewed product
        String category = null;
        try {
            Map<String, String> catNames = buildCategoryNameMap();
            Product viewed = productRepository.findById(new ObjectId(productId)).orElse(null);
            if (viewed != null && viewed.getCategoryIds() != null && !viewed.getCategoryIds().isEmpty()) {
                category = catNames.get(viewed.getCategoryIds().get(0).toHexString());
            }
        } catch (Exception e) {
            log.warn("Could not resolve category for product {}: {}", productId, e.getMessage());
        }

        RecommendationDTO result = buildPersonalizedFromMongo(userId, 30, category);

        // Exclude the viewed product itself
        if (result.getRecommendations() != null) {
            result.setRecommendations(
                result.getRecommendations().stream()
                    .filter(r -> !productId.equals(r.getProductId()))
                    .collect(Collectors.toList())
            );
        }

        // Call ML product-page endpoint (same-category, price-similarity boost)
        result = tryMlEnrichment(result, userId, "product", productId, null);

        if (result.getRecommendations().size() > 8) {
            result.setRecommendations(result.getRecommendations().subList(0, 8));
            result.setTotalCount(8);
        }

        log.info("Product-page: {} recs for user {} product {}", result.getTotalCount(), userId, productId);
        return result;
    }

    /** Cart-page recommendations — mix of ALL categories present in the cart. */
    public RecommendationDTO getCartRecommendations(String userId, List<String> cartProductIds) {
        log.info("Cart recs for user: {} cartItems: {}", userId, cartProductIds.size());

        if (cartProductIds.isEmpty()) {
            return RecommendationDTO.builder()
                    .userId(userId).recommendations(Collections.emptyList())
                    .totalCount(0).algorithmUsed("empty-cart")
                    .generatedAt(java.time.Instant.now().toString()).build();
        }

        // ── Resolve ALL categories of cart items ──────────────────────────────
        Map<String, String> catNames = buildCategoryNameMap();
        Set<String> cartCategories = new java.util.LinkedHashSet<>();
        for (String pid : cartProductIds) {
            try {
                Product p = productRepository.findById(new ObjectId(pid)).orElse(null);
                if (p != null && p.getCategoryIds() != null) {
                    for (ObjectId catId : p.getCategoryIds()) {
                        String catName = catNames.get(catId.toHexString());
                        if (catName != null) cartCategories.add(catName);
                    }
                }
            } catch (Exception ignored) {}
        }

        log.info("Cart categories detected: {}", cartCategories);

        Set<String> cartSet = new java.util.HashSet<>(cartProductIds);

        // ── Layer 1: collect candidates from ALL cart categories equally ──────
        // Allocate slots evenly across cart categories so no single category dominates.
        int totalSlots = 30;
        int slotsPerCat = cartCategories.isEmpty() ? totalSlots
                : Math.max(4, totalSlots / cartCategories.size());

        List<ProductRecommendationDTO> allCandidates = new ArrayList<>();

        if (cartCategories.isEmpty()) {
            // No categories resolved — fall back to generic personalised feed
            RecommendationDTO fallback = buildPersonalizedFromMongo(userId, totalSlots, null);
            allCandidates.addAll(fallback.getRecommendations());
        } else {
            for (String cat : cartCategories) {
                RecommendationDTO catResult = buildPersonalizedFromMongo(userId, slotsPerCat, cat);
                if (catResult.getRecommendations() != null) {
                    allCandidates.addAll(catResult.getRecommendations());
                }
            }
        }

        // Remove products already in the cart
        List<ProductRecommendationDTO> filtered = allCandidates.stream()
                .filter(r -> !cartSet.contains(r.getProductId()))
                // Deduplicate by productId (same product may appear from multiple category queries)
                .collect(Collectors.collectingAndThen(
                    Collectors.toMap(
                        ProductRecommendationDTO::getProductId,
                        r -> r,
                        (a, b) -> a.getScore() >= b.getScore() ? a : b,
                        java.util.LinkedHashMap::new
                    ),
                    m -> new ArrayList<>(m.values())
                ));

        // Sort by score descending
        filtered.sort(Comparator.comparingDouble(ProductRecommendationDTO::getScore).reversed());

        RecommendationDTO result = RecommendationDTO.builder()
                .userId(userId)
                .recommendations(filtered)
                .totalCount(filtered.size())
                .algorithmUsed("cart-multi-category+affinity")
                .generatedAt(java.time.Instant.now().toString())
                .build();

        // ── Layer 2: ML cart endpoint (multi-category + complementary boost) ──
        result = tryMlEnrichment(result, userId, "cart", null, cartProductIds);

        // Trim to 8, ensuring category diversity in the final slice
        List<ProductRecommendationDTO> final8 = ensureCategoryDiversity(
                result.getRecommendations(), cartCategories, 8);
        result.setRecommendations(final8);
        result.setTotalCount(final8.size());

        log.info("Cart: {} recs for user {} (categories: {})", result.getTotalCount(), userId, cartCategories);
        return result;
    }

    /**
     * Interleave results so each cart category gets fair representation
     * in the final top-N slice.
     */
    private List<ProductRecommendationDTO> ensureCategoryDiversity(
            List<ProductRecommendationDTO> recs,
            Set<String> cartCategories,
            int maxResults) {

        if (cartCategories.size() <= 1 || recs == null || recs.isEmpty()) {
            return recs == null ? Collections.emptyList()
                    : recs.subList(0, Math.min(maxResults, recs.size()));
        }

        // Group by category
        Map<String, List<ProductRecommendationDTO>> byCategory = new java.util.LinkedHashMap<>();
        List<ProductRecommendationDTO> other = new ArrayList<>();

        for (ProductRecommendationDTO rec : recs) {
            String cat = rec.getCategory() != null ? rec.getCategory() : "";
            boolean inCartCat = cartCategories.stream()
                    .anyMatch(c -> c.equalsIgnoreCase(cat) || cat.toLowerCase().contains(c.toLowerCase()));
            if (inCartCat) {
                byCategory.computeIfAbsent(cat, k -> new ArrayList<>()).add(rec);
            } else {
                other.add(rec);
            }
        }

        // Round-robin interleave across cart categories
        List<ProductRecommendationDTO> result = new ArrayList<>();
        List<List<ProductRecommendationDTO>> queues = new ArrayList<>(byCategory.values());
        int i = 0;
        while (result.size() < maxResults) {
            boolean added = false;
            for (List<ProductRecommendationDTO> queue : queues) {
                if (!queue.isEmpty() && result.size() < maxResults) {
                    result.add(queue.remove(0));
                    added = true;
                }
            }
            if (!added) break;
        }

        // Fill remaining slots with "other" category items
        for (ProductRecommendationDTO rec : other) {
            if (result.size() >= maxResults) break;
            result.add(rec);
        }

        return result;
    }

    /** Send interaction feedback to ML service (fire-and-forget). */
    public FeedbackResponseDTO sendFeedback(String userId, String productId, String action) {
        if (!config.isEnabled()) {
            return mockService.getMockFeedbackResponse(userId, productId, action);
        }
        try {
            FeedbackResponseDTO result = webClient
                    .post()
                    .uri(uriBuilder -> uriBuilder
                            .path("/feedback")
                            .queryParam("user_id", userId)
                            .queryParam("product_id", productId)
                            .queryParam("action", action)
                            .build())
                    .retrieve()
                    .bodyToMono(FeedbackResponseDTO.class)
                    .timeout(Duration.ofSeconds(config.getTimeoutSeconds()))
                    .retryWhen(Retry.backoff(config.getMaxRetries(), Duration.ofSeconds(1))
                            .filter(this::isRetryableException))
                    .onErrorReturn(null)
                    .block();
            return result != null ? result : mockService.getMockFeedbackResponse(userId, productId, action);
        } catch (Exception e) {
            log.debug("Feedback send failed for user {}: {}", userId, e.getMessage());
            return mockService.getMockFeedbackResponse(userId, productId, action);
        }
    }

    public FeedbackResponseDTO sendFeedback(FeedbackRequestDTO feedbackRequest) {
        return sendFeedback(
                feedbackRequest.getUserId(),
                feedbackRequest.getProductId(),
                feedbackRequest.getAction());
    }

    public boolean isServiceAvailable() {
        if (!config.isEnabled()) return false;
        try {
            webClient.get().uri("/health").retrieve()
                    .bodyToMono(String.class).timeout(Duration.ofSeconds(5)).block();
            return true;
        } catch (Exception e) {
            log.warn("ML service not available: {}", e.getMessage());
            return false;
        }
    }

    private boolean isRetryableException(Throwable throwable) {
        if (throwable instanceof WebClientResponseException ex) {
            return ex.getStatusCode().is5xxServerError();
        }
        return throwable instanceof WebClientException;
    }
}
