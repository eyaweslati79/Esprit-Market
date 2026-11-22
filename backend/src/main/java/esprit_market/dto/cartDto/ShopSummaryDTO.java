package esprit_market.dto.cartDto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Summary of a shop for loyalty display — includes per-shop discount potential
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ShopSummaryDTO {
    
    private String shopId;
    private String shopName;
    private Integer orderCount;
    private Double totalSpent;

    /** Points the user earned specifically from this shop (proportional to spending) */
    private Integer pointsFromShop;

    /** Discount % the user can get at this shop based on their points */
    private Double discountPercentage;

    /** Max TND discount available at this shop with current points */
    private Double maxDiscountTnd;

    /** Example: if next order is X TND, they pay Y TND after discount */
    private Double exampleOrderOriginal;
    private Double exampleOrderAfterDiscount;
}
