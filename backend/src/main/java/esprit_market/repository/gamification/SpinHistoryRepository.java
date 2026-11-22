package esprit_market.repository.gamification;

import esprit_market.entity.gamification.SpinHistory;
import org.bson.types.ObjectId;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface SpinHistoryRepository extends MongoRepository<SpinHistory, ObjectId> {

    /** Check if user has spun on a given date (stored as "yyyy-MM-dd" string) */
    Optional<SpinHistory> findByUserIdAndSpinDate(ObjectId userId, String spinDate);

    /** Paginated history for a user */
    Page<SpinHistory> findByUserIdOrderBySpinTimestampDesc(ObjectId userId, Pageable pageable);

    /** All spins by a user */
    List<SpinHistory> findByUserId(ObjectId userId);

    /** Count spins on a given date */
    long countBySpinDate(String spinDate);

    /** Unclaimed, non-expired rewards */
    List<SpinHistory> findByUserIdAndClaimedFalseAndExpiryDateAfter(ObjectId userId, LocalDateTime now);
}
