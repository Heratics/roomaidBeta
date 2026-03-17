/**
 * RoomAid Authentication Module
 * Handles user authentication, JWT token management, and password operations
 * Provides secure user login and session management functionality
 */

// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================

// Password hashing library for secure password storage
const bcrypt = require('bcryptjs');

// JSON Web Token library for secure authentication tokens
const jwt = require('jsonwebtoken');

// Application configuration settings
const config = require('./config');

// Database connection and query utilities
const db = require('./database');

// ============================================================================
// AUTHENTICATION CLASS
// ============================================================================

/**
 * Authentication class providing user authentication and token management
 * Handles password hashing, JWT generation/verification, and user operations
 */
class Auth {

  /**
   * Hash a password using bcrypt with salt rounds
   * @param {string} password - Plain text password to hash
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, 12);
  }

  /**
   * Verify a password against its hash
   * @param {string} password - Plain text password to verify
   * @param {string} hashedPassword - Hashed password to compare against
   * @returns {Promise<boolean>} True if password matches, false otherwise
   */
  async verifyPassword(password, hashedPassword) {
    // Validate inputs
    if (!password || !hashedPassword) {
      console.error('Invalid password or hash provided for verification');
      return false;
    }

    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  }

  /**
   * Generate a JWT token for authenticated user
   * @param {Object} user - User object containing user data
   * @returns {string} JWT token string
   */
  generateToken(user) {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        hotel_code: user.hotel_code,
        hotelCode: user.hotel_code, // Add both for compatibility
        role: user.role,
        department: user.department || null,
        room_number: user.room_number || null
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  /**
   * Verify and decode a JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object|null} Decoded token payload or null if invalid
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch (error) {
      return null;
    }
  }

  /**
   * Authenticate user with username, password, and optional hotel code
   * @param {string} username - User's username
   * @param {string} password - User's password
   * @param {string} hotel_code - Hotel code for multi-hotel support (optional)
   * @returns {Promise<Object|null>} User object if authenticated, null otherwise
   */
  async authenticateUser(username, password, hotel_code) {
    try {
      let query, params;

      // For admins, allow login with any hotel code (they can access all hotels)
      // For other roles, validate the specific hotel code
      if (hotel_code) {
        // Check if user is admin first
        const adminCheck = await db.query(`
          SELECT u.role FROM users u WHERE u.username = ?
        `, [username]);

        if (adminCheck.length > 0 && adminCheck[0].role === 'admin') {
          // Admin can login with any hotel code - verify it exists
          query = `
            SELECT u.*, h.name as hotelName, h.code as hotelCode
            FROM users u
            LEFT JOIN hotels h ON UPPER(h.code) = UPPER(?)
            WHERE u.username = ? AND u.role = 'admin'
          `;
          params = [hotel_code, username];
        } else {
          // Non-admin users must use their assigned hotel
          query = `
            SELECT u.*, h.name as hotelName, h.code as hotelCode
            FROM users u
            LEFT JOIN hotels h ON UPPER(u.hotel_code) = UPPER(h.code)
            WHERE u.username = ? AND u.hotel_code = ?
          `;
          params = [username, hotel_code];
        }
      } else {
        // Query without hotel code filter (for admin or general login)
        query = `
          SELECT u.*, h.name as hotelName, h.code as hotelCode
          FROM users u
          LEFT JOIN hotels h ON UPPER(u.hotel_code) = UPPER(h.code)
          WHERE u.username = ?
        `;
        params = [username];
      }

      // Query database for user with hotel information
      const users = await db.query(query, params);

      // Debug logging
      console.log('Authentication attempt for:', { username, hotel_code });
      console.log('Users found:', users.length);
      if (users.length > 0) {
        console.log('User data:', {
          id: users[0].id,
          username: users[0].username,
          hasPasswordHash: !!users[0].passwordHash,
          role: users[0].role,
          hotel_code: users[0].hotel_code
        });
      }

      // Check if user exists
      if (users.length === 0) {
        return null;
      }

      const user = users[0];

      // Check if password exists (using password column for now, will migrate to passwordHash later)
      const storedPassword = user.passwordHash || user.password;
      if (!storedPassword) {
        console.error('User found but no password stored:', user.username);
        return null;
      }

      // For now, do simple string comparison since existing passwords are plain text
      // TODO: Migrate to bcrypt hashing
      const isValidPassword = password === storedPassword;

      if (!isValidPassword) {
        return null;
      }

      // For admin users, use the provided hotel code, otherwise use their assigned one
      const finalHotelCode = user.role === 'admin' && hotel_code ? hotel_code : user.hotel_code;

      // Return user object with all necessary information
      return {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        hotelCode: finalHotelCode,
        hotel_code: finalHotelCode,
        role: user.role,
        department: user.department || null,
        room_number: user.room_number || null,
        hotelName: user.hotelName || `Hotel ${finalHotelCode}` // Use actual hotel name if available
      };
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }

  /**
   * Create a new user in the database
   * @param {string} username - Username for the new user
   * @param {string} password - Password for the new user
   * @param {string} hotel_code - Hotel code for the user
   * @param {string} role - User role (default: 'employee')
   * @returns {Promise<Object>} Created user object
   */
  async createUser(username, password, hotel_code, role = 'employee') {
    try {
      // Hash the password before storing
      const passwordHash = await this.hashPassword(password);

      // Insert new user into database with hashed password (let database auto-generate ID)
      const result = await db.query(`
        INSERT INTO users (username, passwordHash, hotel_code, role, first_name, last_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [username, passwordHash, hotel_code, role, username, '']);

      // Get the auto-generated ID
      const userId = result.insertId;

      // Return created user object
      return { id: userId, username, hotel_code, role };
    } catch (error) {
      console.error('User creation error:', error);
      throw error;
    }
  }

  /**
   * Generate a unique ID for database records
   * @returns {string} Unique ID string
   */
  generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

// Export singleton instance of Auth class
module.exports = new Auth(); 