package esprit_market.service.cartService;

import esprit_market.Enum.cartEnum.OrderStatus;
import esprit_market.Enum.notificationEnum.NotificationType;
import esprit_market.entity.cart.LoyaltyCard;
import esprit_market.entity.user.User;
import esprit_market.repository.cartRepository.LoyaltyCardRepository;
import esprit_market.repository.cartRepository.OrderRepository;
import esprit_market.repository.userRepository.UserRepository;
import esprit_market.service.notificationService.INotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Smart Loyalty Scheduler
 *
 * Implements the two missing features from the Dynamic Loyalty & Smart Rewards spec:
 *
 * 1. Auto-coupon for inactive users (7+ days without order)
 *    → Generates a 10% discount coupon and sends a notification
 *
 * 2. Points expiration alerts (7 days before expiry)
 *    → Sends a proactive notification so users don't lose their points
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SmartLoyaltyScheduler {

    private final LoyaltyCardRepository loyaltyCardRepository;
    private final OrderRepository orderRepository;
    private final UserRepository userRepository;
    private final INotificationService notificationService;

    // ── 1. Re-engagement coupon for inactive users ────────────────────────────

    /**
     * Runs every day at 09:00.
     * Finds users who have not placed an order in the last 7 days
     * and have a loyalty card (i.e. they are known customers).
     * Generates a 10% re-engagement coupon and notifies them.
     */
    @Scheduled(cron = "0 0 9 * * *")
    @Transactional
    public void sendReEngagementCoupons() {
        log.info("🔍 [SmartLoyalty] Checking for inactive users to re-engage...");

        LocalDateTime sevenDaysAgo = LocalDateTime.now().minusDays(7);

        List<LoyaltyCard> allCards = loyaltyCardRepository.findAll();
        int sent = 0;

        for (LoyaltyCard card : allCards) {
            try {
                User user = card.getUser();
                if (user == null) continue;

                // Check if user placed any order in the last 7 days
                long recentOrders = orderRepository.countByUserIdAndCreatedAtAfterAndStatusNot(
                        user.getId(), sevenDaysAgo, OrderStatus.CANCELLED);

                if (recentOrders > 0) continue; // Active user — skip

                // Check if user has any points (only re-engage users who earned something)
                int points = card.getPoints() != null ? card.getPoints() : 0;
                if (points == 0) continue;

                // Generate a unique 10% coupon code
                String couponCode = "COMEBACK-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();

                // Notify the user
                String title = "🎁 We miss you! Here's a special offer";
                String message = String.format(
                        "It's been a while! Use code %s for 10%% OFF your next order. " +
                        "You also have %d loyalty points waiting for you. Valid for 48 hours!",
                        couponCode, points);

                notificationService.sendNotification(
                        user, title, message,
                        NotificationType.LOYALTY_COUPON,
                        couponCode);

                log.info("✅ [SmartLoyalty] Re-engagement coupon {} sent to user {}", couponCode, user.getId());
                sent++;

            } catch (Exception e) {
                log.error("❌ [SmartLoyalty] Failed to process re-engagement for card {}: {}",
                        card.getId(), e.getMessage());
            }
        }

        log.info("✅ [SmartLoyalty] Re-engagement job done — {} coupon(s) sent", sent);
    }

    // ── 2. Points expiration alerts ───────────────────────────────────────────

    /**
     * Runs every day at 10:00.
     * Finds users whose points expire within the next 7 days
     * and sends them a proactive notification.
     */
    @Scheduled(cron = "0 0 10 * * *")
    @Transactional
    public void sendPointsExpirationAlerts() {
        log.info("🔍 [SmartLoyalty] Checking for expiring loyalty points...");

        LocalDate today = LocalDate.now();
        LocalDate alertThreshold = today.plusDays(7); // alert 7 days before expiry

        List<LoyaltyCard> allCards = loyaltyCardRepository.findAll();
        int alerted = 0;

        for (LoyaltyCard card : allCards) {
            try {
                if (card.getPointsExpireAt() == null) continue;

                int points = card.getPoints() != null ? card.getPoints() : 0;
                if (points <= 0) continue;

                LocalDate expiryDate = card.getPointsExpireAt();

                // Only alert if expiry is within the next 7 days (and not already expired)
                if (expiryDate.isAfter(today) && !expiryDate.isAfter(alertThreshold)) {
                    User user = card.getUser();
                    if (user == null) continue;

                    long daysLeft = today.until(expiryDate, java.time.temporal.ChronoUnit.DAYS);

                    String title = "⏳ Your loyalty points are expiring soon!";
                    String message = String.format(
                            "You have %d loyalty points that will expire in %d day(s) (on %s). " +
                            "Redeem them now for discounts and rewards before they're gone!",
                            points, daysLeft, expiryDate);

                    notificationService.sendNotification(
                            user, title, message,
                            NotificationType.LOYALTY_POINTS_EXPIRING,
                            card.getId().toHexString());

                    log.info("⏳ [SmartLoyalty] Points expiry alert sent to user {} ({} pts, expires {})",
                            user.getId(), points, expiryDate);
                    alerted++;
                }

            } catch (Exception e) {
                log.error("❌ [SmartLoyalty] Failed to process expiry alert for card {}: {}",
                        card.getId(), e.getMessage());
            }
        }

        log.info("✅ [SmartLoyalty] Points expiry job done — {} alert(s) sent", alerted);
    }

    // ── 3. Loyalty boost notification ─────────────────────────────────────────

    /**
     * Runs every day at 08:00.
     * Notifies users who have unlocked a dynamic boost (≥3 orders this month)
     * so they know their earning rate has increased.
     */
    @Scheduled(cron = "0 0 8 * * *")
    public void notifyLoyaltyBoostUnlocks() {
        log.info("🔍 [SmartLoyalty] Checking for loyalty boost unlocks...");

        LocalDateTime oneMonthAgo = LocalDateTime.now().minusMonths(1);
        List<LoyaltyCard> allCards = loyaltyCardRepository.findAll();
        int notified = 0;

        for (LoyaltyCard card : allCards) {
            try {
                User user = card.getUser();
                if (user == null) continue;

                long orderCount = orderRepository.countByUserIdAndCreatedAtAfterAndStatusNot(
                        user.getId(), oneMonthAgo, OrderStatus.CANCELLED);

                String boostMsg = null;
                if (orderCount >= 10) {
                    boostMsg = String.format(
                            "🔥 You've unlocked a HIGH loyalty boost! With %d orders this month, " +
                            "you're earning +20%% extra points on every purchase!", orderCount);
                } else if (orderCount == 3) {
                    // Exactly 3 = just unlocked medium boost
                    boostMsg = String.format(
                            "⭐ You've unlocked a loyalty boost! With %d orders this month, " +
                            "you're now earning +10%% extra points on every purchase!", orderCount);
                }

                if (boostMsg != null) {
                    notificationService.sendNotification(
                            user,
                            "🚀 Loyalty Boost Activated!",
                            boostMsg,
                            NotificationType.LOYALTY_BOOST,
                            null);
                    notified++;
                }

            } catch (Exception e) {
                log.error("❌ [SmartLoyalty] Failed to process boost notification for card {}: {}",
                        card.getId(), e.getMessage());
            }
        }

        log.info("✅ [SmartLoyalty] Boost notification job done — {} user(s) notified", notified);
    }
}
