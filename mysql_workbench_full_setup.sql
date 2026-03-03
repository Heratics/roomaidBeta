-- RoomAid full MySQL bootstrap script
-- Run this entire script in MySQL Workbench on a fresh server/database.
-- Update the variables in the "SEED INPUTS" section before running.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ==============================
-- DATABASE
-- ==============================
-- Change `roomaid` if you want a different database name.
CREATE DATABASE IF NOT EXISTS roomaid
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE roomaid;

-- ==============================
-- TABLES
-- ==============================

CREATE TABLE IF NOT EXISTS hotels (
  id VARCHAR(50) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hotel_departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hotel_code VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_hotel_dept (hotel_code, department),
  CONSTRAINT fk_hotel_departments_hotel_code
    FOREIGN KEY (hotel_code) REFERENCES hotels(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  passwordHash VARCHAR(255) NOT NULL,
  hotel_code VARCHAR(50) NOT NULL,
  role VARCHAR(20) DEFAULT 'employee',
  department VARCHAR(50) DEFAULT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_users_hotel_code (hotel_code),
  CONSTRAINT fk_users_hotel_code
    FOREIGN KEY (hotel_code) REFERENCES hotels(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS engineering_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_name VARCHAR(255) NOT NULL,
  order_notes TEXT,
  sent_by INT NOT NULL,
  assigned_to INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  deleted_at DATETIME NULL,
  hotel_code VARCHAR(50) NOT NULL,
  on_hold BOOLEAN DEFAULT FALSE,
  hold_info VARCHAR(255) NULL,
  hold_until DATETIME NULL,
  hold_reason TEXT NULL,
  KEY idx_engineering_hotel_created (hotel_code, created_at),
  KEY idx_engineering_assigned (assigned_to),
  CONSTRAINT fk_engineering_sent_by
    FOREIGN KEY (sent_by) REFERENCES users(id),
  CONSTRAINT fk_engineering_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS housekeeping_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_name VARCHAR(255) NOT NULL,
  order_notes TEXT,
  sent_by INT NOT NULL,
  assigned_to INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  deleted_at DATETIME NULL,
  hotel_code VARCHAR(50) NOT NULL,
  on_hold BOOLEAN DEFAULT FALSE,
  hold_info VARCHAR(255) NULL,
  hold_until DATETIME NULL,
  hold_reason TEXT NULL,
  KEY idx_housekeeping_hotel_created (hotel_code, created_at),
  KEY idx_housekeeping_assigned (assigned_to),
  CONSTRAINT fk_housekeeping_sent_by
    FOREIGN KEY (sent_by) REFERENCES users(id),
  CONSTRAINT fk_housekeeping_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS laundry_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_name VARCHAR(255) NOT NULL,
  order_notes TEXT,
  sent_by INT NOT NULL,
  assigned_to INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  deleted_at DATETIME NULL,
  hotel_code VARCHAR(50) NOT NULL,
  on_hold BOOLEAN DEFAULT FALSE,
  hold_info VARCHAR(255) NULL,
  hold_until DATETIME NULL,
  hold_reason TEXT NULL,
  KEY idx_laundry_hotel_created (hotel_code, created_at),
  KEY idx_laundry_assigned (assigned_to),
  CONSTRAINT fk_laundry_sent_by
    FOREIGN KEY (sent_by) REFERENCES users(id),
  CONSTRAINT fk_laundry_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roomservice_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_name VARCHAR(255) NOT NULL,
  order_notes TEXT,
  sent_by INT NOT NULL,
  assigned_to INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  deleted_at DATETIME NULL,
  hotel_code VARCHAR(50) NOT NULL,
  on_hold BOOLEAN DEFAULT FALSE,
  hold_info VARCHAR(255) NULL,
  hold_until DATETIME NULL,
  hold_reason TEXT NULL,
  KEY idx_roomservice_hotel_created (hotel_code, created_at),
  KEY idx_roomservice_assigned (assigned_to),
  CONSTRAINT fk_roomservice_sent_by
    FOREIGN KEY (sent_by) REFERENCES users(id),
  CONSTRAINT fk_roomservice_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  order_type ENUM('engineering', 'housekeeping', 'laundry', 'roomservice') NOT NULL,
  action_type ENUM('deleted', 'edited', 'restored', 'hold') NOT NULL,
  changed_by INT NOT NULL,
  changed_by_name VARCHAR(200),
  hotel_code VARCHAR(50) NOT NULL,
  old_data JSON,
  new_data JSON,
  change_description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_logs_hotel_created (hotel_code, created_at),
  KEY idx_order_logs_order_type (order_id, order_type),
  CONSTRAINT fk_order_logs_changed_by
    FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  order_type ENUM('engineering', 'housekeeping', 'laundry', 'roomservice') NOT NULL,
  hotel_code VARCHAR(50) NOT NULL,
  notification_level INT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_notification (order_id, order_type, notification_level),
  KEY idx_order_notifications_hotel (hotel_code),
  CONSTRAINT fk_order_notifications_hotel_code
    FOREIGN KEY (hotel_code) REFERENCES hotels(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  username VARCHAR(255) NOT NULL,
  fcm_token TEXT NOT NULL,
  device_info JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_username (username),
  INDEX idx_created_at (created_at),
  UNIQUE KEY uniq_user_token (user_id, (fcm_token(255))),
  CONSTRAINT fk_fcm_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional cleanup of old web-push tables from legacy versions
DROP TABLE IF EXISTS notf;
DROP TABLE IF EXISTS push_subscriptions;

-- ==============================
-- SEED INPUTS (EDIT THESE)
-- ==============================
SET @hotel_id = 'hotel_001';
SET @hotel_code = 'HOTEL001';
SET @hotel_name = 'RoomAid Demo Hotel';

SET @admin_username = 'admin';
SET @admin_password = 'admin';
SET @admin_first_name = 'System';
SET @admin_last_name = 'Admin';

-- ==============================
-- SEED DATA
-- ==============================

INSERT INTO hotels (id, code, name)
VALUES (@hotel_id, @hotel_code, @hotel_name)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  updatedAt = CURRENT_TIMESTAMP;

INSERT INTO hotel_departments (hotel_code, department)
VALUES
  (@hotel_code, 'Engineering'),
  (@hotel_code, 'Housekeeping'),
  (@hotel_code, 'Laundry'),
  (@hotel_code, 'Room Service')
ON DUPLICATE KEY UPDATE
  department = VALUES(department);

-- IMPORTANT:
-- Current auth flow checks password as plain text against `passwordHash`.
-- So this stores your admin password directly for compatibility with current code.
-- If you later switch auth to bcrypt compare, replace this with a bcrypt hash.
INSERT INTO users (username, passwordHash, hotel_code, role, department, first_name, last_name)
VALUES (@admin_username, @admin_password, @hotel_code, 'admin', NULL, @admin_first_name, @admin_last_name)
ON DUPLICATE KEY UPDATE
  passwordHash = VALUES(passwordHash),
  hotel_code = VALUES(hotel_code),
  role = VALUES(role),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  updatedAt = CURRENT_TIMESTAMP;

SELECT '✅ RoomAid database setup complete' AS status, @hotel_code AS hotel_code, @admin_username AS admin_username;
