package esprit_market.controller.marketplaceController;

import esprit_market.dto.marketplace.ProductResponseDTO;
import esprit_market.entity.marketplace.Product;
import esprit_market.service.marketplaceService.ProductService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.bson.types.ObjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
@Tag(name = "Flash Sale", description = "Flash sale management APIs")
public class FlashSaleController {

    private static final Logger log = LoggerFactory.getLogger(FlashSaleController.class);
    private final ProductService productService;

    // ── Request body ──────────────────────────────────────────────────────────
    @Data
    public static class FlashSaleRequest {
        private double flashSalePrice;
        /** Duration in hours: 24, 48, or 72 */
        private int durationHours;
        /** Optional: max units to sell at flash price */
        private Integer maxQuantity;
    }

    // ── Start a flash sale ────────────────────────────────────────────────────
    @PostMapping("/{id}/flash-sale/start")
    @PreAuthorize("hasRole('ADMIN') or (hasRole('PROVIDER') and @marketplaceSecurity.isProductOwner(authentication, #id))")
    @Operation(summary = "Start a flash sale for a product (PROVIDER/ADMIN)")
    public ProductResponseDTO startFlashSale(
            @PathVariable ObjectId id,
            @RequestBody FlashSaleRequest req) {

        if (req.getFlashSalePrice() <= 0) {
            throw new IllegalArgumentException("Flash sale price must be greater than 0");
        }
        if (req.getDurationHours() != 24 && req.getDurationHours() != 48 && req.getDurationHours() != 72) {
            throw new IllegalArgumentException("Duration must be 24, 48, or 72 hours");
        }

        Product product = productService.findEntityById(id);

        if (req.getFlashSalePrice() >= product.getPrice()) {
            throw new IllegalArgumentException("Flash sale price must be lower than the original price");
        }

        LocalDateTime now = LocalDateTime.now();
        product.setFlashSaleActive(true);
        product.setFlashSalePrice(req.getFlashSalePrice());
        product.setFlashSaleStartTime(now);
        product.setFlashSaleEndTime(now.plusHours(req.getDurationHours()));
        product.setFlashSaleMaxQuantity(req.getMaxQuantity());
        product.setFlashSaleSoldQuantity(0);

        log.info("Flash sale started for product {} — price: {} TND for {} hours",
                id, req.getFlashSalePrice(), req.getDurationHours());

        return productService.saveAndMap(product);
    }

    // ── Stop a flash sale ─────────────────────────────────────────────────────
    @PostMapping("/{id}/flash-sale/stop")
    @PreAuthorize("hasRole('ADMIN') or (hasRole('PROVIDER') and @marketplaceSecurity.isProductOwner(authentication, #id))")
    @Operation(summary = "Stop an active flash sale (PROVIDER/ADMIN)")
    public ProductResponseDTO stopFlashSale(@PathVariable ObjectId id) {
        Product product = productService.findEntityById(id);
        product.setFlashSaleActive(false);
        product.setFlashSaleEndTime(LocalDateTime.now());
        log.info("Flash sale stopped for product {}", id);
        return productService.saveAndMap(product);
    }

    // ── Get all currently live flash sales ────────────────────────────────────
    @GetMapping("/flash-sales/live")
    @Operation(summary = "Get all products with an active flash sale right now (public)")
    public List<ProductResponseDTO> getLiveFlashSales() {
        LocalDateTime now = LocalDateTime.now();
        return productService.findAll().stream()
                .filter(dto -> dto.isFlashSaleLive())
                .collect(Collectors.toList());
    }
}
