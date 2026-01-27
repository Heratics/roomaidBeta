const mysql = require('mysql2/promise');
const config = require('./config');

class Database {
  constructor() {
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = mysql.createPool(config.db);
      // Test connection
      const connection = await this.pool.getConnection();
      console.log('✅ Connected to MySQL database');
      connection.release();

      // Create tables if they don't exist
      await this.createTables();
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async createTables() {
    try {
      // Create Hotels table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS hotels (
          id VARCHAR(50) PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create Users table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          passwordHash VARCHAR(255) NOT NULL,
          hotel_code VARCHAR(50) NOT NULL,
          role VARCHAR(20) DEFAULT 'employee',
          department VARCHAR(50) DEFAULT NULL,
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (hotel_code) REFERENCES hotels(code)
        )
      `);

      // Create Engineering Orders table
      await this.pool.query(`
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
          FOREIGN KEY (sent_by) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
      `);

      // Create Housekeeping Orders table
      await this.pool.query(`
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
          FOREIGN KEY (sent_by) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
      `);

      // Create Laundry Orders table
      await this.pool.query(`
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
          FOREIGN KEY (sent_by) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
      `);

      // Create Room Service Orders table
      await this.pool.query(`
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
          FOREIGN KEY (sent_by) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
      `);

      // Create Order Logs table to track changes
      await this.pool.query(`
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
          FOREIGN KEY (changed_by) REFERENCES users(id)
        )
      `);

      // Add hold columns to engineering_orders if they don't exist
      try {
        await this.pool.query(`
          ALTER TABLE engineering_orders
          ADD COLUMN on_hold BOOLEAN DEFAULT FALSE,
          ADD COLUMN hold_info VARCHAR(255) NULL,
          ADD COLUMN hold_until DATETIME NULL
        `);
      } catch (error) {
        // Columns might already exist, ignore error
        console.log('Hold columns might already exist in engineering_orders');
      }

      // Add hold columns to housekeeping_orders if they don't exist
      try {
        await this.pool.query(`
          ALTER TABLE housekeeping_orders
          ADD COLUMN on_hold BOOLEAN DEFAULT FALSE,
          ADD COLUMN hold_info VARCHAR(255) NULL,
          ADD COLUMN hold_until DATETIME NULL
        `);
      } catch (error) {
        // Columns might already exist, ignore error
        console.log('Hold columns might already exist in housekeeping_orders');
      }

      // Add hold columns to laundry_orders if they don't exist
      try {
        await this.pool.query(`
          ALTER TABLE laundry_orders
          ADD COLUMN on_hold BOOLEAN DEFAULT FALSE,
          ADD COLUMN hold_info VARCHAR(255) NULL,
          ADD COLUMN hold_until DATETIME NULL
        `);
      } catch (error) {
        // Columns might already exist, ignore error
        console.log('Hold columns might already exist in laundry_orders');
      }

      // Add hold columns to roomservice_orders if they don't exist
      try {
        await this.pool.query(`
          ALTER TABLE roomservice_orders
          ADD COLUMN on_hold BOOLEAN DEFAULT FALSE,
          ADD COLUMN hold_info VARCHAR(255) NULL,
          ADD COLUMN hold_until DATETIME NULL
        `);
      } catch (error) {
        // Columns might already exist, ignore error
        console.log('Hold columns might already exist in roomservice_orders');
      }

      // Update order_logs action_type enum to include 'hold' if it doesn't exist
      try {
        await this.pool.query(`
          ALTER TABLE order_logs
          MODIFY COLUMN action_type ENUM('deleted', 'edited', 'restored', 'hold') NOT NULL
        `);
      } catch (error) {
        console.log('order_logs action_type enum might already include hold');
      }

      // Add hold_reason column to engineering_orders if it doesn't exist
      try {
        await this.pool.query(`
          ALTER TABLE engineering_orders
          ADD COLUMN hold_reason TEXT NULL
        `);
      } catch (error) {
        console.log('hold_reason column might already exist in engineering_orders');
      }

      // Add hold_reason column to housekeeping_orders if it doesn't exist
      try {
        await this.pool.query(`
          ALTER TABLE housekeeping_orders
          ADD COLUMN hold_reason TEXT NULL
        `);
      } catch (error) {
        console.log('hold_reason column might already exist in housekeeping_orders');
      }

      // Add hold_reason column to laundry_orders if it doesn't exist
      try {
        await this.pool.query(`
          ALTER TABLE laundry_orders
          ADD COLUMN hold_reason TEXT NULL
        `);
      } catch (error) {
        console.log('hold_reason column might already exist in laundry_orders');
      }

      // Add hold_reason column to roomservice_orders if it doesn't exist
      try {
        await this.pool.query(`
          ALTER TABLE roomservice_orders
          ADD COLUMN hold_reason TEXT NULL
        `);
      } catch (error) {
        console.log('hold_reason column might already exist in roomservice_orders');
      }

      // Create Notifications table to track pending order notifications
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS order_notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          order_type ENUM('engineering', 'housekeeping', 'laundry', 'roomservice') NOT NULL,
          hotel_code VARCHAR(50) NOT NULL,
          notification_level INT DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_notification (order_id, order_type, notification_level),
          FOREIGN KEY (hotel_code) REFERENCES hotels(code)
        )
      `);

      // Create FCM tokens table for Firebase push notifications
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS fcm_tokens (
          id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          username VARCHAR(255) NOT NULL,
          fcm_token TEXT NOT NULL,
          device_info JSON DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          INDEX idx_user_id (user_id),
          INDEX idx_username (username),
          INDEX idx_created_at (created_at),
          UNIQUE KEY uniq_user_token (user_id, (fcm_token(255)))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Add department column to users table if it doesn't exist
      try {
        await this.pool.query(`
          ALTER TABLE users
          ADD COLUMN department VARCHAR(50) DEFAULT NULL
        `);
      } catch (error) {
        console.log('Department column might already exist in users table');
      }

      console.log('✅ Database tables created/verified');
    } catch (error) {
      console.error('❌ Error creating tables:', error);
      throw error;
    }
  }

  async query(sqlQuery, params = []) {
    try {
      // Execute the query
      // Note: server.js needs to be updated to use ? placeholders instead of @param
      const [rows] = await this.pool.execute(sqlQuery, params);
      return rows;
    } catch (error) {
      console.error('❌ Database query error:', error);
      throw error;
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('✅ Database connection closed');
    }
  }
}

module.exports = new Database();
