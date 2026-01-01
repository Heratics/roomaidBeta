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

      // Create Order Logs table to track changes
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS order_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          order_type ENUM('engineering', 'housekeeping') NOT NULL,
          action_type ENUM('deleted', 'edited', 'restored') NOT NULL,
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
