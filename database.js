const sql = require('mssql');
const config = require('./config');

class Database {
  constructor() {
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = await new sql.ConnectionPool(config.db).connect();
      console.log('✅ Connected to SQL Server database');
      
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
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='hotels' AND xtype='U')
        CREATE TABLE hotels (
          id NVARCHAR(50) PRIMARY KEY,
          code NVARCHAR(50) UNIQUE NOT NULL,
          name NVARCHAR(100) NOT NULL,
          createdAt DATETIME DEFAULT GETDATE(),
          updatedAt DATETIME DEFAULT GETDATE()
        )
      `);

      // Create Users table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
        CREATE TABLE users (
          id INT IDENTITY(1,1) PRIMARY KEY,
          username NVARCHAR(50) UNIQUE NOT NULL,
          passwordHash NVARCHAR(255) NOT NULL,
          hotel_code NVARCHAR(50) NOT NULL,
          role NVARCHAR(20) DEFAULT 'employee',
          first_name NVARCHAR(100),
          last_name NVARCHAR(100),
          name NVARCHAR(100),
          createdAt DATETIME DEFAULT GETDATE(),
          updatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (hotel_code) REFERENCES hotels(code)
        )
      `);

      // Create Engineering Orders table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='engineering_orders' AND xtype='U')
        CREATE TABLE engineering_orders (
          id INT IDENTITY(1,1) PRIMARY KEY,
          order_name NVARCHAR(255) NOT NULL,
          order_notes TEXT,
          sent_by INT NOT NULL,
          assigned_to INT NULL,
          created_at DATETIME DEFAULT GETDATE(),
          completed_at DATETIME NULL,
          deleted_at DATETIME NULL,
          hotel_code NVARCHAR(50) NOT NULL,
          FOREIGN KEY (sent_by) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
      `);

      // Create Housekeeping Orders table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='housekeeping_orders' AND xtype='U')
        CREATE TABLE housekeeping_orders (
          id INT IDENTITY(1,1) PRIMARY KEY,
          order_name NVARCHAR(255) NOT NULL,
          order_notes TEXT,
          sent_by INT NOT NULL,
          assigned_to INT NULL,
          created_at DATETIME DEFAULT GETDATE(),
          completed_at DATETIME NULL,
          deleted_at DATETIME NULL,
          hotel_code NVARCHAR(50) NOT NULL,
          FOREIGN KEY (sent_by) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
      `);

      // Add deleted_at column to existing tables if they don't have it
      try {
        await this.pool.request().query(`
          IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'engineering_orders' AND COLUMN_NAME = 'deleted_at')
          ALTER TABLE engineering_orders ADD deleted_at DATETIME NULL
        `);
        
        await this.pool.request().query(`
          IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'housekeeping_orders' AND COLUMN_NAME = 'deleted_at')
          ALTER TABLE housekeeping_orders ADD deleted_at DATETIME NULL
        `);
      } catch (migrationError) {
        console.log('ℹ️ Migration note: Some columns may already exist');
      }

      // Add first_name and last_name columns to existing users table if they don't exist
      try {
        // Add first_name column if it doesn't exist
        await this.pool.request().query(`
          IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'first_name')
          ALTER TABLE users ADD first_name NVARCHAR(100) NULL
        `);
        
        // Add last_name column if it doesn't exist
        await this.pool.request().query(`
          IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'last_name')
          ALTER TABLE users ADD last_name NVARCHAR(100) NULL
        `);
        
        // Rename name column to last_name if it exists and last_name doesn't exist
        await this.pool.request().query(`
          IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'name')
          AND NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'last_name')
          BEGIN
            EXEC sp_rename 'users.name', 'last_name', 'COLUMN'
          END
        `);
        
        // If name column still exists and we have both first_name and last_name, drop the name column
        await this.pool.request().query(`
          IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'name')
          AND EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'first_name')
          AND EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'last_name')
          BEGIN
            ALTER TABLE users DROP COLUMN name
          END
        `);
      } catch (migrationError) {
        console.log('ℹ️ Migration note: Some user columns may already exist or migration failed:', migrationError.message);
      }

      console.log('✅ Database tables created/verified');
    } catch (error) {
      console.error('❌ Error creating tables:', error);
      throw error;
    }
  }

  async query(sqlQuery, params = []) {
    try {
      const request = this.pool.request();
      
      // Add parameters if provided with proper validation
      params.forEach((param, index) => {
        // Validate parameter before adding
        if (param === null || param === undefined) {
          request.input(`param${index + 1}`, null);
        } else {
          // Handle different data types properly
          if (typeof param === 'number' || !isNaN(parseInt(param))) {
            // If it's a number or can be parsed as a number, use it as an integer
            request.input(`param${index + 1}`, parseInt(param));
          } else if (param instanceof Date) {
            // If it's a Date object, use it as is
            request.input(`param${index + 1}`, param);
          } else {
            // Otherwise, convert to string
            request.input(`param${index + 1}`, String(param));
          }
        }
      });
      
      const result = await request.query(sqlQuery);
      return result.recordset;
    } catch (error) {
      console.error('❌ Database query error:', error);
      throw error;
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      console.log('✅ Database connection closed');
    }
  }
}

module.exports = new Database(); 