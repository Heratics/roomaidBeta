/**
 * RoomAid Server Application
 * Main Express.js server for the hotel task management system
 * Handles authentication, API endpoints, and database operations
 */
require('dotenv').config();


// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================

// Core Express.js framework for web server functionality
const express = require('express');

// Cross-Origin Resource Sharing middleware for API access
const cors = require('cors');

// Session management middleware for user sessions
const session = require('express-session');

// Input validation and security utilities
const validation = require('./lib/validation');

// Node.js path module for file path operations
const path = require('path');

// Application configuration settings
const config = require('./config');

// Database connection and query utilities
const db = require('./database');

// Authentication utilities (JWT, password hashing, etc.)
const auth = require('./auth');

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

// Create Express application instance
const app = express();

// Get server port from configuration or use default
const PORT = config.server.port;

// ============================================================================
// MIDDLEWARE SETUP
// ============================================================================

// Enable CORS for cross-origin requests
app.use(cors());

// Parse JSON request bodies with size limit
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies with size limit
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers middleware
app.use((req, res, next) => {
  const headers = validation.getSecurityHeaders();
  Object.keys(headers).forEach(key => {
    res.setHeader(key, headers[key]);
  });
  next();
});

// Rate limiting middleware
app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

  // More lenient rate limiting for admin pages and auth endpoints
  const isAdminPage = req.path.startsWith('/admin') || req.path.startsWith('/api/admin');
  const isAuthEndpoint = req.path.startsWith('/api/auth');
  const rateLimit = (isAdminPage || isAuthEndpoint) ? 200 : 100; // 200 requests per minute for admin/auth, 100 for others
  const isAllowed = validation.checkRateLimit(clientIP, rateLimit, 60000);

  if (!isAllowed) {
    console.log(`Rate limit exceeded for IP: ${clientIP}, Path: ${req.path}`);
    return res.status(429).json({
      error: 'Too many requests, please try again later',
      retryAfter: 60 // seconds
    });
  }

  next();
});

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Configure session management
app.use(session({
  secret: config.jwtSecret, // Secret key for session encryption
  resave: false, // Don't save session if unmodified
  saveUninitialized: false, // Don't create session until something stored
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // Session expires in 24 hours
  }
}));

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Middleware to authenticate JWT tokens
 * Verifies token validity and attaches user data to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateToken = (req, res, next) => {
  // Extract token from Authorization header or session
  const token = req.headers.authorization?.split(' ')[1] || req.session.token;

  // Check if token exists
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Verify token and get user data
  const user = auth.verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Attach user data to request for use in route handlers
  req.user = user;
  next();
};

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token
 * Required fields: username, password
 * Optional field: hotelCode (for regular users)
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    // Extract login credentials from request body
    const { username, password, hotelCode } = req.body;

    // Validate and sanitize input
    const usernameValidation = validation.validateUsername(username);
    const passwordValidation = validation.validatePassword(password);

    // Check validation results
    if (!usernameValidation.isValid) {
      return res.status(400).json({ error: usernameValidation.error });
    }
    if (!passwordValidation.isValid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    // If hotelCode is provided, validate it
    let hotelCodeValidation = { isValid: true, value: hotelCode };
    if (hotelCode) {
      hotelCodeValidation = validation.validateHotelCode(hotelCode);
      if (!hotelCodeValidation.isValid) {
        return res.status(400).json({ error: hotelCodeValidation.error });
      }
    }

    // Authenticate user credentials with sanitized input
    const user = await auth.authenticateUser(
      usernameValidation.value,
      passwordValidation.value,
      hotelCodeValidation.value
    );

    // Check if authentication failed
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token for authenticated user
    const token = auth.generateToken(user);

    // Store token in session for server-side access
    req.session.token = token;
    req.session.user = user;

    // Return success response with token and user data
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name || user.username,
        hotelCode: user.hotelCode,
        hotel_code: user.hotel_code,
        role: user.role,
        hotelName: user.hotelName
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Clear user session and logout
 */
app.post('/api/auth/logout', (req, res) => {
  // Destroy the user session
  req.session.destroy();
  res.json({ success: true });
});

/**
 * GET /api/orders
 * Retrieve orders for a specific department with optional date filtering
 * Requires authentication
 * Query parameters: department, date (optional)
 */
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    // Extract query parameters
    const { department, date } = req.query;
    const user = req.user;

    // Validate required department parameter
    if (!department) {
      return res.status(400).json({ error: 'Department is required' });
    }



    // Build SQL query to fetch orders from the appropriate department table
    const tableName = department.toLowerCase() === 'engineering' ? 'engineering_orders' : 'housekeeping_orders';
    let query = `
      SELECT o.*, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
             assignee.username as receiverUsername
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NULL
    `;

    // Filter by user's hotel code to ensure they only see orders from their hotel
    // Also exclude soft-deleted orders
    let params = [user.hotel_code || user.hotelCode];

    // Add date filter if provided
    if (date) {
      query += ` AND DATE(o.created_at) = ?`;
      params.push(date);
    }

    // Order results by creation date (newest first)
    query += ` ORDER BY o.created_at DESC`;

    // Execute query to get orders for the hotel and department
    const orders = await db.query(query, params);

    // Return orders as JSON response
    res.json({ orders });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/orders
 * Create a new order
 * Requires authentication
 * Required fields: roomNumber, department
 * Optional fields: notes
 */
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    // Extract order data from request body
    const { roomNumber, notes, department } = req.body;
    const user = req.user;

    // Debug logging
    console.log('Order creation request:', { roomNumber, notes, department, user: user });

    // Validate and sanitize input
    const roomNumberValidation = validation.validateRoomNumber(roomNumber);
    const notesValidation = validation.validateNotes(notes);
    const departmentValidation = validation.validateDepartment(department);

    // Check validation results
    if (!roomNumberValidation.isValid) {
      return res.status(400).json({ error: roomNumberValidation.error });
    }
    if (!notesValidation.isValid) {
      return res.status(400).json({ error: notesValidation.error });
    }
    if (!departmentValidation.isValid) {
      return res.status(400).json({ error: departmentValidation.error });
    }

    // Insert new order into the appropriate department table (let database auto-generate ID)
    const tableName = departmentValidation.value.toLowerCase() === 'engineering' ? 'engineering_orders' : 'housekeeping_orders';

    const hotelCode = user.hotel_code || user.hotelCode;
    console.log('Using hotel code:', hotelCode);

    const result = await db.query(`
      INSERT INTO ${tableName} (order_name, order_notes, sent_by, created_at, hotel_code)
      VALUES (?, ?, ?, NOW(), ?)
    `, [`Room ${roomNumberValidation.value}`, notesValidation.value || '', user.id, hotelCode]);

    // Get the auto-generated ID
    // valid for mysql2/promise execute() result which returns [ResultSetHeader, FieldPacket[]]
    const orderId = result.insertId;

    // Fetch the created order with creator information
    const orders = await db.query(`
      SELECT o.*, creator.username as creatorUsername, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      WHERE o.id = ?
    `, [orderId]);

    // Return the created order
    res.json({ order: orders[0] });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/orders/:id/receive
 * Mark an order as received (assign to current user)
 * Requires authentication
 * URL parameter: id (order ID)
 */
app.post('/api/orders/:id/receive', authenticateToken, async (req, res) => {
  try {
    // Extract order ID from URL parameters
    const { id } = req.params;
    const user = req.user;

    // First, find which table the order is in and verify it belongs to user's hotel and is not deleted
    let tableName = null;
    let orderFound = false;

    // Check engineering_orders first
    let checkResult = await db.query(`SELECT id FROM engineering_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, user.hotel_code || user.hotelCode]);
    if (checkResult.length > 0) {
      tableName = 'engineering_orders';
      orderFound = true;
    } else {
      // Check housekeeping_orders
      checkResult = await db.query(`SELECT id FROM housekeeping_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, user.hotel_code || user.hotelCode]);
      if (checkResult.length > 0) {
        tableName = 'housekeeping_orders';
        orderFound = true;
      }
    }

    if (!orderFound) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Update order to assign to current user (this acts as "receiving" the order)
    await db.query(`
      UPDATE ${tableName} 
      SET assigned_to = ?
      WHERE id = ?
    `, [user.id, id]);

    // Fetch the updated order with creator and assignee information
    const orders = await db.query(`
      SELECT o.*, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
             assignee.username as receiverUsername
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.id = ?
    `, [id]);

    // Check if order was found
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Return the updated order
    res.json({ order: orders[0] });
  } catch (error) {
    console.error('Receive order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/orders/:id
 * Delete an order
 * Requires authentication
 * URL parameter: id (order ID)
 * Optional body field: deletionReason
 */
app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    // Extract order ID from URL parameters and deletion reason from request body
    const { id } = req.params;
    const { deletionReason } = req.body;
    const user = req.user;

    // First, find which table the order is in and verify it belongs to user's hotel and is not deleted
    let tableName = null;
    let orderFound = false;

    // Check engineering_orders first
    let checkResult = await db.query(`SELECT id FROM engineering_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, user.hotel_code || user.hotelCode]);
    if (checkResult.length > 0) {
      tableName = 'engineering_orders';
      orderFound = true;
    } else {
      // Check housekeeping_orders
      checkResult = await db.query(`SELECT id FROM housekeeping_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, user.hotel_code || user.hotelCode]);
      if (checkResult.length > 0) {
        tableName = 'housekeeping_orders';
        orderFound = true;
      }
    }

    if (!orderFound) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Get order data before deletion for logging
    const orderData = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
    
    // Soft delete the order by setting deleted_at timestamp
    await db.query(`
      UPDATE ${tableName} 
      SET deleted_at = ?
      WHERE id = ?
    `, [new Date(), id]);

    // Log the deletion
    const userFullName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}` 
      : user.username;
    
    const reasonText = deletionReason ? ` - Reason: ${deletionReason}` : '';
    
    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, old_data, change_description)
      VALUES (?, ?, 'deleted', ?, ?, ?, ?, ?)
    `, [
      id,
      tableName === 'engineering_orders' ? 'engineering' : 'housekeeping',
      user.id,
      userFullName,
      user.hotel_code || user.hotelCode,
      JSON.stringify(orderData[0]),
      `Order deleted by ${userFullName}${reasonText}`
    ]);

    // Return success response
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/orders/:id/complete
 * Mark an order as completed
 * Requires authentication
 * URL parameter: id (order ID)
 */
app.post('/api/orders/:id/complete', authenticateToken, async (req, res) => {
  try {
    // Extract order ID from URL parameters
    const { id } = req.params;
    const user = req.user;

    // Convert id to integer for database query
    const orderId = parseInt(id);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    console.log('Complete order request:', { id: orderId, user: user.id, hotel_code: user.hotel_code || user.hotelCode });

    // First, find which table the order is in and verify it belongs to user's hotel and is not deleted
    let tableName = null;
    let orderFound = false;

    // Check engineering_orders first
    console.log('Checking engineering_orders for order:', orderId);
    let checkResult = await db.query(`SELECT id FROM engineering_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [orderId, user.hotel_code || user.hotelCode]);
    console.log('Engineering check result:', checkResult);

    if (checkResult.length > 0) {
      tableName = 'engineering_orders';
      orderFound = true;
    } else {
      // Check housekeeping_orders
      console.log('Checking housekeeping_orders for order:', orderId);
      checkResult = await db.query(`SELECT id FROM housekeeping_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [orderId, user.hotel_code || user.hotelCode]);
      console.log('Housekeeping check result:', checkResult);

      if (checkResult.length > 0) {
        tableName = 'housekeeping_orders';
        orderFound = true;
      }
    }

    console.log('Order found:', orderFound, 'Table:', tableName);

    if (!orderFound) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Update order to mark as completed and set completion timestamp
    console.log('Updating order in table:', tableName);
    const updateResult = await db.query(`
      UPDATE ${tableName} 
      SET completed_at = ?
      WHERE id = ?
    `, [new Date(), orderId]);
    console.log('Update result:', updateResult);

    // Fetch the updated order with creator and assignee information
    console.log('Fetching updated order');
    const orders = await db.query(`
      SELECT o.*, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
             assignee.username as receiverUsername
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.id = ?
    `, [orderId]);
    console.log('Fetched orders:', orders);

    // Check if order was found
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Return the updated order
    console.log('Returning completed order');
    res.json({ order: orders[0] });
  } catch (error) {
    console.error('Complete order error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

/**
 * PUT /api/orders/:id
 * Edit an order
 * Requires authentication
 * URL parameter: id (order ID)
 */
app.put('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { order_name, order_notes, department } = req.body;
    const user = req.user;

    // Validate required fields
    if (!order_name || !department) {
      return res.status(400).json({ error: 'Order name and department are required' });
    }

    // Determine table name based on department
    const tableName = department.toLowerCase() === 'engineering' ? 'engineering_orders' : 'housekeeping_orders';

    // Check if order exists and belongs to user's hotel
    const orderCheck = await db.query(`SELECT * FROM ${tableName} WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, user.hotel_code || user.hotelCode]);
    
    if (orderCheck.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    const oldOrderData = orderCheck[0];

    // Update the order
    await db.query(`
      UPDATE ${tableName} 
      SET order_name = ?, order_notes = ?
      WHERE id = ?
    `, [order_name, order_notes || null, id]);

    // Get updated order data
    const updatedOrder = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);

    // Log the edit
    const userFullName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}` 
      : user.username;
    
    const changes = [];
    if (oldOrderData.order_name !== order_name) {
      changes.push(`Order name: "${oldOrderData.order_name}" → "${order_name}"`);
    }
    if (oldOrderData.order_notes !== (order_notes || null)) {
      changes.push(`Notes: "${oldOrderData.order_notes || ''}" → "${order_notes || ''}"`);
    }

    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, old_data, new_data, change_description)
      VALUES (?, ?, 'edited', ?, ?, ?, ?, ?, ?)
    `, [
      id,
      department.toLowerCase() === 'engineering' ? 'engineering' : 'housekeeping',
      user.id,
      userFullName,
      user.hotel_code || user.hotelCode,
      JSON.stringify(oldOrderData),
      JSON.stringify(updatedOrder[0]),
      changes.length > 0 ? `Order edited by ${userFullName}: ${changes.join('; ')}` : `Order edited by ${userFullName}`
    ]);

    res.json({ success: true, message: 'Order updated successfully', order: updatedOrder[0] });
  } catch (error) {
    console.error('Edit order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/orders/deleted
 * Retrieve soft-deleted orders for audit purposes (admin/supervisor only)
 * Requires authentication and admin or supervisor role
 */
app.get('/api/orders/deleted', authenticateToken, async (req, res) => {
  try {
    const { department } = req.query;
    const user = req.user;

    // Check if user is admin or supervisor
    if (user.role !== 'admin' && user.role !== 'supervisor') {
      return res.status(403).json({ error: 'Admin or supervisor access required' });
    }

    // Validate required department parameter
    if (!department) {
      return res.status(400).json({ error: 'Department is required' });
    }

    // Build SQL query to fetch soft-deleted orders
    const tableName = department.toLowerCase() === 'engineering' ? 'engineering_orders' : 'housekeeping_orders';
    let query = `
      SELECT o.*, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
             assignee.username as receiverUsername
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NOT NULL
    `;

    // Filter by user's hotel code and only show soft-deleted orders
    let params = [user.hotel_code || user.hotelCode];

    // Order results by deletion date (newest first)
    query += ` ORDER BY o.deleted_at DESC`;

    // Execute query to get soft-deleted orders
    const orders = await db.query(query, params);

    // Return orders as JSON response
    res.json({ orders });
  } catch (error) {
    console.error('Get deleted orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/orders/:id/restore
 * Restore a soft-deleted order (admin/supervisor only)
 * Requires authentication and admin or supervisor role
 */
app.post('/api/orders/:id/restore', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Check if user is admin or supervisor
    if (user.role !== 'admin' && user.role !== 'supervisor') {
      return res.status(403).json({ error: 'Admin or supervisor access required' });
    }

    // First, find which table the order is in and verify it belongs to user's hotel and is deleted
    let tableName = null;
    let orderFound = false;

    // Check engineering_orders first
    let checkResult = await db.query(`SELECT id FROM engineering_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NOT NULL`, [id, user.hotel_code || user.hotelCode]);
    if (checkResult.length > 0) {
      tableName = 'engineering_orders';
      orderFound = true;
    } else {
      // Check housekeeping_orders
      checkResult = await db.query(`SELECT id FROM housekeeping_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NOT NULL`, [id, user.hotel_code || user.hotelCode]);
      if (checkResult.length > 0) {
        tableName = 'housekeeping_orders';
        orderFound = true;
      }
    }

    if (!orderFound) {
      return res.status(404).json({ error: 'Deleted order not found or access denied' });
    }

    // Restore the order by setting deleted_at to NULL
    await db.query(`
      UPDATE ${tableName} 
      SET deleted_at = NULL
      WHERE id = ?
    `, [id]);

    // Return success response
    res.json({ success: true, message: 'Order restored successfully' });
  } catch (error) {
    console.error('Restore order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/orders/:id
 * Edit an order
 * Requires authentication
 * URL parameter: id (order ID)
 */
app.put('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { order_name, order_notes, department } = req.body;
    const user = req.user;

    // Validate required fields
    if (!order_name || !department) {
      return res.status(400).json({ error: 'Order name and department are required' });
    }

    // Determine table name based on department
    const tableName = department.toLowerCase() === 'engineering' ? 'engineering_orders' : 'housekeeping_orders';

    // Check if order exists and belongs to user's hotel
    const orderCheck = await db.query(`SELECT * FROM ${tableName} WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, user.hotel_code || user.hotelCode]);
    
    if (orderCheck.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    const oldOrderData = orderCheck[0];

    // Update the order
    await db.query(`
      UPDATE ${tableName} 
      SET order_name = ?, order_notes = ?
      WHERE id = ?
    `, [order_name, order_notes || null, id]);

    // Get updated order data
    const updatedOrder = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);

    // Log the edit
    const userFullName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}` 
      : user.username;
    
    const changes = [];
    if (oldOrderData.order_name !== order_name) {
      changes.push(`Order name: "${oldOrderData.order_name}" → "${order_name}"`);
    }
    if (oldOrderData.order_notes !== (order_notes || null)) {
      changes.push(`Notes: "${oldOrderData.order_notes || ''}" → "${order_notes || ''}"`);
    }

    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, old_data, new_data, change_description)
      VALUES (?, ?, 'edited', ?, ?, ?, ?, ?, ?)
    `, [
      id,
      department.toLowerCase() === 'engineering' ? 'engineering' : 'housekeeping',
      user.id,
      userFullName,
      user.hotel_code || user.hotelCode,
      JSON.stringify(oldOrderData),
      JSON.stringify(updatedOrder[0]),
      changes.length > 0 ? `Order edited by ${userFullName}: ${changes.join('; ')}` : `Order edited by ${userFullName}`
    ]);

    res.json({ success: true, message: 'Order updated successfully', order: updatedOrder[0] });
  } catch (error) {
    console.error('Edit order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/logs
 * Get order logs (deleted and edited orders)
 * Requires authentication and manager/admin/supervisor role
 * Query parameters: type (optional), date (optional)
 */
app.get('/api/logs', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    // Check if user is admin, manager, or supervisor
    if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'supervisor') {
      return res.status(403).json({ error: 'Manager or admin access required' });
    }

    const { type, date } = req.query; // 'deleted' or 'edited', and optional date filter

    let query = `
      SELECT l.*,
             COALESCE(CONCAT(u.first_name, ' ', u.last_name), u.username) as changed_by_full_name
      FROM order_logs l
      LEFT JOIN users u ON l.changed_by = u.id
      WHERE l.hotel_code = ?
    `;

    const params = [user.hotel_code || user.hotelCode];

    if (type) {
      query += ` AND l.action_type = ?`;
      params.push(type);
    }

    if (date) {
      query += ` AND DATE(l.created_at) = ?`;
      params.push(date);
    }

    query += ` ORDER BY l.created_at DESC`;

    const logs = await db.query(query, params);

    res.json({ logs });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/verify
 * Verify JWT token and return user data
 * Requires authentication
 */
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  try {
    // User data is already attached by authenticateToken middleware
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/hotels
 * Get all hotels (admin only)
 * Requires authentication and admin role
 */
app.get('/api/admin/hotels', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get all hotels
    const hotels = await db.query(`
      SELECT h.id, h.name, h.code
      FROM hotels h
      ORDER BY h.id DESC
    `);

    res.json({ hotels });
  } catch (error) {
    console.error('Get hotels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/users
 * Get all users (admin only) with optional search functionality and pagination
 * Requires authentication and admin role
 * Query parameters: search (optional), page (optional), limit (optional)
 */
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { search, page = 1, limit = 25 } = req.query;

    console.log('Admin users request:', {
      user: user.id,
      hotel_code: user.hotel_code || user.hotelCode,
      role: user.role,
      search,
      page,
      limit
    });

    // For admin users, let's show all users regardless of hotel code
    // or at least debug what hotel codes exist
    if (user.role === 'admin') {
      console.log('Admin user detected - checking all users in database');
      const allUsersDebug = await db.query('SELECT id, username, hotel_code, role FROM users');
      console.log('All users in database:', allUsersDebug);
    }

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Parse pagination parameters
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pageNum - 1) * pageSize;

    let baseQuery, countQuery, params;

    // For admin users, show all users regardless of hotel code
    // For regular users, filter by their hotel code
    const isAdmin = user.role === 'admin';

    if (search && search.trim()) {
      // Search users by name, username, or hotel code
      const searchTerm = `%${search.trim()}%`;

      if (isAdmin) {
        baseQuery = `
          SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role,
                 h.name as hotelName
          FROM users u
          LEFT JOIN hotels h ON u.hotel_code = h.code
          WHERE (
            u.username LIKE ? 
            OR u.first_name LIKE ? 
            OR u.last_name LIKE ? 
            OR h.name LIKE ?
          )
          ORDER BY u.id DESC
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM users u
          LEFT JOIN hotels h ON u.hotel_code = h.code
          WHERE (
            u.username LIKE ? 
            OR u.first_name LIKE ? 
            OR u.last_name LIKE ? 
            OR h.name LIKE ?
          )
        `;
        params = [searchTerm, searchTerm, searchTerm, searchTerm];
      } else {
        baseQuery = `
          SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role,
                 h.name as hotelName
          FROM users u
          LEFT JOIN hotels h ON u.hotel_code = h.code
          WHERE u.hotel_code = ? 
          AND (
            u.username LIKE ? 
            OR u.first_name LIKE ? 
            OR u.last_name LIKE ? 
            OR h.name LIKE ?
          )
          ORDER BY u.id DESC
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM users u
          LEFT JOIN hotels h ON u.hotel_code = h.code
          WHERE u.hotel_code = ? 
          AND (
            u.username LIKE ? 
            OR u.first_name LIKE ? 
            OR u.last_name LIKE ? 
            OR h.name LIKE ?
          )
        `;
        params = [user.hotel_code || user.hotelCode, searchTerm, searchTerm, searchTerm, searchTerm];
      }
    } else {
      // Get users (all for admin, filtered by hotel for regular users)
      if (isAdmin) {
        baseQuery = `
          SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role,
                 h.name as hotelName
          FROM users u
          LEFT JOIN hotels h ON u.hotel_code = h.code
          ORDER BY u.id DESC
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM users u
        `;
        params = [];
      } else {
        baseQuery = `
          SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role,
                 h.name as hotelName
          FROM users u
          LEFT JOIN hotels h ON u.hotel_code = h.code
          WHERE u.hotel_code = ?
          ORDER BY u.id DESC
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM users u
          WHERE u.hotel_code = ?
        `;
        params = [user.hotel_code || user.hotelCode];
      }
    }

    // Get all users (simplified for now)
    console.log('Base query:', baseQuery);
    console.log('Base params:', params);
    const users = await db.query(baseQuery, params);

    console.log('Users result:', {
      usersCount: users.length,
      currentPage: pageNum,
      pageSize
    });

    res.json({
      users,
      searchTerm: search || null,
      totalCount: users.length,
      currentPage: pageNum,
      pageSize,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/hotels
 * Create a new hotel (admin only)
 * Requires authentication and admin role
 */
app.post('/api/admin/hotels', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { name, code } = req.body;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate required fields
    if (!name || !code) {
      return res.status(400).json({ error: 'Hotel name and code are required' });
    }

    // Check if hotel code already exists
    const existingHotels = await db.query(`
      SELECT id FROM hotels WHERE code = ?
    `, [code]);

    if (existingHotels.length > 0) {
      return res.status(400).json({ error: 'Hotel code already exists' });
    }

    // Create hotel
    await db.query(`
      INSERT INTO hotels (id, name, code, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `, [
      code, // Use code as ID for simplicity
      name,
      code,
      new Date(),
      new Date()
    ]);

    res.json({
      success: true,
      message: 'Hotel created successfully',
      hotel: {
        id: code,
        name,
        code
      }
    });
  } catch (error) {
    console.error('Create hotel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 * Requires authentication and admin role
 */
app.post('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { firstName, lastName, username, password, hotelCode, role } = req.body;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate input
    const usernameValidation = validation.validateUsername(username);
    const passwordValidation = validation.validatePassword(password);
    const hotelCodeValidation = validation.validateHotelCode(hotelCode);

    if (!usernameValidation.isValid) {
      return res.status(400).json({ error: usernameValidation.error });
    }
    if (!passwordValidation.isValid) {
      return res.status(400).json({ error: passwordValidation.error });
    }
    if (!hotelCodeValidation.isValid) {
      return res.status(400).json({ error: hotelCodeValidation.error });
    }

    // Check if username already exists
    const existingUsers = await db.query(`
      SELECT id FROM users WHERE username = ?
    `, [usernameValidation.value]);

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Create user with plain text password for now (matching existing system)
    const result = await db.query(`
      INSERT INTO users (username, passwordHash, hotel_code, role, first_name, last_name, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      usernameValidation.value,
      passwordValidation.value, // Store as plain text for now
      hotelCodeValidation.value,
      role || 'employee',
      firstName,
      lastName,
      new Date()
    ]);

    const newUserId = result[0].insertId;

    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        id: newUserId,
        username: usernameValidation.value,
        first_name: firstName,
        last_name: lastName,
        name: `${firstName} ${lastName}`.trim(), // Keep for backward compatibility
        hotel_code: hotelCodeValidation.value,
        role: role || 'employee'
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/hotels/:id
 * Delete a hotel (admin only)
 * Requires authentication and admin role
 */
app.delete('/api/admin/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check if hotel exists and get its code
    const existingHotel = await db.query(`
      SELECT id, code FROM hotels WHERE id = ?
    `, [id]);

    if (existingHotel.length === 0) {
      return res.status(404).json({ error: 'Hotel not found' });
    }

    const hotelCode = existingHotel[0].code;

    // Check if hotel has users (users reference hotel_code, not hotel id)
    const hotelUsers = await db.query(`
      SELECT COUNT(*) as userCount FROM users WHERE hotel_code = ?
    `, [hotelCode]);

    if (hotelUsers[0].userCount > 0) {
      return res.status(400).json({ error: 'Cannot delete hotel with existing users. Please reassign or delete users first.' });
    }

    // Delete hotel
    await db.query(`
      DELETE FROM hotels WHERE id = ?
    `, [id]);

    res.json({
      success: true,
      message: 'Hotel deleted successfully'
    });
  } catch (error) {
    console.error('Delete hotel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user (admin only)
 * Requires authentication and admin role
 */
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check if target user exists (admin can delete any user)
    const targetUser = await db.query(`
      SELECT id, username FROM users 
      WHERE id = ?
    `, [id]);

    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent admin from deleting themselves
    if (parseInt(id) === user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Delete the user
    await db.query(`
      DELETE FROM users WHERE id = ?
    `, [id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/seed
 * Create sample data for development/testing
 * Creates test hotels, users, and orders
 */
app.post('/api/seed', async (req, res) => {
  try {
    // Create sample hotels if they don't exist
    const existingHotel1 = await db.query(`SELECT id FROM hotels WHERE code = ?`, ['HOTEL001']);
    if (existingHotel1.length === 0) {
      await db.query(`INSERT INTO hotels (id, code, name) VALUES (?, ?, ?)`, ['HOTEL001', 'HOTEL001', 'Grand Plaza Hotel']);
    }

    const existingHotel2 = await db.query(`SELECT id FROM hotels WHERE code = ?`, ['HOTEL002']);
    if (existingHotel2.length === 0) {
      await db.query(`INSERT INTO hotels (id, code, name) VALUES (?, ?, ?)`, ['HOTEL002', 'HOTEL002', 'Seaside Resort & Spa']);
    }

    const existingHotel3 = await db.query(`SELECT id FROM hotels WHERE code = ?`, ['HOTEL003']);
    if (existingHotel3.length === 0) {
      await db.query(`INSERT INTO hotels (id, code, name) VALUES (?, ?, ?)`, ['HOTEL003', 'HOTEL003', 'Downtown Business Center']);
    }

    // Create sample users for testing
    const user1 = await auth.createUser('admin', 'password123', 'HOTEL001', 'admin');
    const user2 = await auth.createUser('admin2', 'password123', 'HOTEL002', 'admin');

    // Create sample orders for testing in engineering_orders table
    await db.query(`
      INSERT INTO engineering_orders (order_name, order_notes, sent_by, created_at, hotel_code)
      VALUES 
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?)
    `, [
      'Room 101', 'Light bulb needs replacement', user1.id, new Date(), 'HOTEL001',
      'Room 312', 'AC not working properly', user1.id, new Date(), 'HOTEL001'
    ]);

    // Create sample orders for testing in housekeeping_orders table
    await db.query(`
      INSERT INTO housekeeping_orders (order_name, order_notes, sent_by, created_at, hotel_code)
      VALUES 
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?)
    `, [
      'Room 205', 'Room needs cleaning after checkout', user1.id, new Date(), 'HOTEL001',
      'Room 105', 'Deep clean required', user2.id, new Date(), 'HOTEL002'
    ]);

    // Return success response with test credentials
    res.json({
      success: true,
      message: 'Sample data created',
      credentials: {
        hotel1: {
          username: 'admin',
          password: 'password123',
          hotelCode: 'HOTEL001'
        },
        hotel2: {
          username: 'admin2',
          password: 'password123',
          hotelCode: 'HOTEL002'
        }
      }
    });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

/**
 * GET /
 * Serve the main HTML file for the application
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * GET /admin
 * Serve the admin panel HTML file
 */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Start the server and establish database connection
 * Handles startup errors gracefully
 */
// Debug endpoint to check database data
app.get('/api/debug/data', async (req, res) => {
  try {
    const users = await db.query('SELECT COUNT(*) as userCount FROM users');
    const hotels = await db.query('SELECT COUNT(*) as hotelCount FROM hotels');
    const orders = await db.query('SELECT COUNT(*) as orderCount FROM engineering_orders');

    res.json({
      users: users[0].userCount,
      hotels: hotels[0].hotelCount,
      orders: orders[0].orderCount
    });
  } catch (error) {
    console.error('Debug data error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Debug endpoint to test user creation
app.post('/api/debug/create-user', async (req, res) => {
  try {
    const { username, password, hotelCode, role } = req.body;

    // Create a simple user
    const result = await db.query(`
      INSERT INTO users (username, passwordHash, hotel_code, role, first_name, last_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [username, password, hotelCode, role || 'employee', username, '']);

    res.json({
      success: true,
      userId: result.insertId,
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Debug create user error:', error);
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
});

async function startServer() {
  try {
    // Connect to database
    await db.connect();

    // Start listening for HTTP requests
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Local: http://localhost:${PORT}`);
      console.log(`📦 Database Host: ${config.db.host}`);
      console.log(`🐛 Debug endpoint enabled`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();