-- ============================================================================
-- RoomAid Customer & Room User Migration
-- Run this script ONCE to add the required columns and updates
-- ============================================================================

-- 1. Add room_number column to users table (for customer/room accounts)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS room_number VARCHAR(20) DEFAULT NULL;

-- 2. Update order_logs to include 'cancelled' action type (for customer cancellations)
ALTER TABLE order_logs
  MODIFY COLUMN action_type ENUM('deleted', 'edited', 'restored', 'hold', 'cancelled') NOT NULL;

-- (Optional) Add an index on room_number for faster lookups
ALTER TABLE users
  ADD INDEX IF NOT EXISTS idx_room_number (room_number);

-- ============================================================================
-- Verification queries - run these after to confirm success
-- ============================================================================
-- SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
--   WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'room_number';
