-- Create FCM (Firebase Cloud Messaging) tokens table
-- This table stores device tokens for push notifications

CREATE TABLE IF NOT EXISTS `fcm_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `username` VARCHAR(255) NOT NULL,
  `fcm_token` TEXT NOT NULL,
  `device_info` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_username` (`username`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clean up old web-push tables
DROP TABLE IF EXISTS `notf`;
DROP TABLE IF EXISTS `push_subscriptions`;

-- Note: Run this SQL script in your database to create the FCM tokens table
-- You can execute it using MySQL command line or a database management tool
