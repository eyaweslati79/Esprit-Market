package esprit_market.entity.gamification;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.bson.types.ObjectId;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Document(collection = "spin_history")
@CompoundIndex(name = "user_date_idx", def = "{'userId': 1, 'spinDate': 1}")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SpinHistory {

    @Id
    private ObjectId id;

    private LocalDateTime createdAt;

    private ObjectId userId;
    private ObjectId rewardId;

    /**
     * Stored as ISO date string "yyyy-MM-dd" — avoids LocalDate serialization issues with MongoDB.
     */
    private String spinDate;

    private LocalDateTime spinTimestamp;

    @Builder.Default
    private Boolean claimed = false;

    private LocalDateTime claimedAt;

    private String ipAddress;
    private String userAgent;

    // Reward snapshot
    private String rewardLabel;
    private RewardType rewardType;
    private Double rewardValue;

    private LocalDateTime expiryDate;
}
