/**
 * RoomAid Server Application
 * Main Express.js server for the hotel task management system
 * Handles authentication, API endpoints, and database operations
 */
const dotenv = require('dotenv');
dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.DB_SERVER) {
  dotenv.config({ path: '.env.render' });
}


// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================

// Core Express.js framework for web server functionality
const express = require('express');
const dns = require('dns').promises;
const net = require('net');

// Cross-Origin Resource Sharing middleware for API access
const cors = require('cors');

// Session management middleware for user sessions
const session = require('express-session');

// Core application modules
const path = require('path');
const config = require('./config');
const db = require('./database');
const auth = require('./auth');
const validation = require('./lib/validation');
const orderNotifications = require('./utils/orderNotifications');

// FCM (Firebase Cloud Messaging) routes
const fcmRoutes = require('./routes/fcm');

// Initialize Express app and middleware
const app = express();
const PORT = config.server.port || process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'roomaid-session-secret',
  resave: false,
  saveUninitialized: false
}));

app.use((req, res, next) => {
  const headers = validation.getSecurityHeaders();
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  next();
});

// Serve static assets
app.use(express.static('public', { index: false }));

// Initialize FCM routes
fcmRoutes.createFCMRoutes(app);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Map department name to database table name
 * @param {string} department - Department name
 * @returns {string} Database table name
 */
function getDepartmentTableName(department) {
  if (!department || typeof department !== 'string') return null;

  const departmentTableMap = {
    engineering: 'engineering_orders',
    housekeeping: 'housekeeping_orders',
    laundry: 'laundry_orders',
    'room service': 'roomservice_orders',
    roomservice: 'roomservice_orders'
  };

  const normalizedDepartment = department.toLowerCase().trim();
  return departmentTableMap[normalizedDepartment] || null;
}

function blockDebugRoutesInProduction(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/**
 * Map database table name to order type for logs
 * @param {string} tableName - Database table name
 * @returns {string} Order type for logs
 */
function getOrderTypeFromTableName(tableName) {
  switch (tableName) {
    case 'engineering_orders':
      return 'engineering';
    case 'housekeeping_orders':
      return 'housekeeping';
    case 'laundry_orders':
      return 'laundry';
    case 'roomservice_orders':
      return 'roomservice';
    default:
      return 'engineering';
  }
}

function isFrontDeskAccessUser(user) {
  if (!user) return false;
  const normalizedDepartment = String(user.department || '')
    .toLowerCase()
    .replace(/[\s_]+/g, '');

  return user.role === 'front_desk' || (user.role === 'employee' && normalizedDepartment === 'frontdesk');
}

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
        hotelName: user.hotelName,
        department: user.department || null,
        room_number: user.room_number || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);

    const transientDbCodes = ['ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST'];
    if (transientDbCodes.includes(String(error.code || '').toUpperCase())) {
      return res.status(503).json({ error: 'Database is temporarily unavailable. Please try again shortly.' });
    }

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

    const departmentValidation = validation.validateDepartment(department);
    if (!departmentValidation.isValid) {
      return res.status(400).json({ error: departmentValidation.error });
    }

    // Build SQL query to fetch orders from the appropriate department table
    const tableName = getDepartmentTableName(departmentValidation.value);
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid department' });
    }
    let query = `
      SELECT o.*, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
             assignee.username as receiverUsername
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NULL
    `;

    // Filter by user's hotel code to ensure they only see orders from their hotel
    // Also exclude soft-deleted orders
    let params = [user.hotel_code || user.hotelCode];

    // Customers can only see orders they personally submitted
    if (user.role === 'customer') {
      query += ` AND o.sent_by = ?`;
      params.push(user.id);
    }

    // If user is an employee, only show orders from their assigned department
    // Front desk can see all departments
    const isFrontDeskUser = isFrontDeskAccessUser(user);
    if (user.role === 'employee' && user.department && !isFrontDeskUser) {
      // Check if the requested department matches the user's assigned department
      if (String(department).toLowerCase() !== String(user.department).toLowerCase()) {
        return res.status(403).json({ error: 'You can only view orders from your assigned department' });
      }
    }

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
    const tableName = getDepartmentTableName(departmentValidation.value);

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
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      WHERE o.id = ?
    `, [orderId]);

    const createdOrder = orders[0];

    // Send FCM notification to all users in the same hotel
    try {
      // Get all users from the same hotel (excluding the creator)
      const hotelUsers = await db.query(
        'SELECT id FROM users WHERE hotel_code = ? AND id != ?',
        [hotelCode, user.id]
      );

      if (hotelUsers && hotelUsers.length > 0) {
        const userIds = hotelUsers.map(u => u.id);
        
        // Send FCM notification
        await fcmRoutes.sendFCMNotification(userIds, {
          title: '🆕 New Order Received!',
          body: `${departmentValidation.value}: Room ${roomNumberValidation.value}`,
          data: {
            orderId: orderId.toString(),
            orderName: createdOrder.order_name,
            department: departmentValidation.value,
            level: '0', // New order
            creatorName: createdOrder.creatorName || 'Unknown',
            type: 'new_order'
          }
        });
        
        console.log(`✅ FCM notification sent for new order ${orderId}`);
      }
    } catch (fcmError) {
      console.warn('FCM notification failed (non-critical):', fcmError.message);
      // Don't fail the request if notification fails
    }

    // Schedule reminder notifications for the new order
    try {
      await orderNotifications.scheduleReminders(orderId, departmentValidation.value.toLowerCase(), hotelCode, {
        roomNumber: roomNumberValidation.value,
        notes: notesValidation.value || ''
      });
      console.log(`✅ Reminders scheduled for order ${orderId}`);
    } catch (remErr) {
      console.warn('Reminder scheduling failed (non-critical):', remErr.message);
    }

    // Return the created order
    res.json({ order: createdOrder });
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
    const hotelCode = user.hotel_code || user.hotelCode;
    const tableNames = ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders'];

    // Check all department tables
    for (const tbl of tableNames) {
      const checkResult = await db.query(`SELECT id FROM ${tbl} WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, hotelCode]);
      if (checkResult.length > 0) {
        tableName = tbl;
        orderFound = true;
        break;
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
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
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

    // Clear reminders upon acceptance
    try {
      await orderNotifications.handleOrderAcceptance(id);
    } catch (remErr) {
      console.warn('Clearing reminders on acceptance failed (non-critical):', remErr.message);
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
 * Delete/cancel an order
 * Requires authentication
 * URL parameter: id (order ID)
 * Optional body field: deletionReason (required for customers)
 */
app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    // Extract order ID from URL parameters and deletion reason from request body
    const { id } = req.params;
    const { deletionReason } = req.body;
    const user = req.user;

    // Customers MUST provide a reason to cancel their order
    if (user.role === 'customer' && (!deletionReason || !deletionReason.trim())) {
      return res.status(400).json({ error: 'A cancellation reason is required to cancel your order.' });
    }

    // First, find which table the order is in and verify it belongs to user's hotel and is not deleted
    let tableName = null;
    let orderFound = false;
    const hotelCode = user.hotel_code || user.hotelCode;
    const tableNames = ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders'];

    // Check all department tables
    for (const tbl of tableNames) {
      const checkResult = await db.query(`SELECT id, sent_by FROM ${tbl} WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [id, hotelCode]);
      if (checkResult.length > 0) {
        // Customers can only cancel their own orders
        if (user.role === 'customer' && checkResult[0].sent_by !== user.id) {
          return res.status(403).json({ error: 'You can only cancel your own orders.' });
        }
        tableName = tbl;
        orderFound = true;
        break;
      }
    }

    if (!orderFound) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Get order data before deletion for logging
    const orderData = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
    
    // Clear any scheduled reminders for this order
    orderNotifications.clearReminders(id);
    
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
      getOrderTypeFromTableName(tableName),
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
    const { id } = req.params;
    const user = req.user;
    const orderId = parseInt(id);

    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const hotelCode = user.hotel_code || user.hotelCode;
    const tableNames = ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders'];

    // Find which table the order is in
    let tableName = null;
    for (const tbl of tableNames) {
      const checkResult = await db.query(`SELECT id FROM ${tbl} WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [orderId, hotelCode]);
      if (checkResult.length > 0) {
        tableName = tbl;
        break;
      }
    }

    if (!tableName) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Mark order as completed
    await db.query(`
      UPDATE ${tableName}
      SET completed_at = NOW()
      WHERE id = ?
    `, [orderId]);

    // Fetch the updated order
    const orders = await db.query(`
      SELECT o.*,
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
             assignee.username as receiverUsername
      FROM ${tableName} o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.id = ?
    `, [orderId]);

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Clear reminders upon completion
    try {
      await orderNotifications.handleOrderCompletion(orderId);
    } catch (remErr) {
      console.warn('Clearing reminders on completion failed (non-critical):', remErr.message);
    }

    res.json({ order: orders[0] });
  } catch (error) {
    console.error('Complete order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/orders/:id/hold
 * Put an order on hold
 * Requires authentication
 * URL parameter: id (order ID)
 * Body: { day, timeFrame }
 */
app.post('/api/orders/:id/hold', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { day, timeFrame, reason, nextDayTime } = req.body;
    const user = req.user;

    // Convert id to integer for database query
    const orderId = parseInt(id);
    if (isNaN(orderId)) {
      console.error('Invalid order ID:', id);
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    console.log('Hold order request:', { id: orderId, day, timeFrame, nextDayTime, reason, user: user.id, hotel_code: user.hotel_code || user.hotelCode });

    // Validate day parameter
    if (!day || (day !== 'same-day' && day !== 'next-day')) {
      console.error('Invalid day parameter:', day);
      return res.status(400).json({ error: 'Invalid day parameter. Must be "same-day" or "next-day"' });
    }

    // First, find which table the order is in and verify it belongs to user's hotel and is not deleted
    let tableName = null;
    let orderFound = false;

    // Check engineering_orders first
    let checkResult = await db.query(`SELECT id FROM engineering_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [orderId, user.hotel_code || user.hotelCode]);
    if (checkResult.length > 0) {
      tableName = 'engineering_orders';
      orderFound = true;
    } else {
      // Check housekeeping_orders
      checkResult = await db.query(`SELECT id FROM housekeeping_orders WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`, [orderId, user.hotel_code || user.hotelCode]);
      if (checkResult.length > 0) {
        tableName = 'housekeeping_orders';
        orderFound = true;
      }
    }

    if (!orderFound) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Prepare hold information
    const holdInfo = day === 'same-day' ? `On hold - Same day (${timeFrame})` : 'On hold - Next day';
    
    // Calculate hold_until date and created_at date if next-day
    let holdUntil = null;
    let newCreatedAt = null;
    if (day === 'next-day') {
      // Set hold_until to end of next day
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      holdUntil = tomorrow;
      
      // Parse nextDayTime (format: HH:MM)
      if (nextDayTime) {
        const [hours, minutes] = nextDayTime.split(':').map(Number);
        const tomorrowWithTime = new Date();
        tomorrowWithTime.setDate(tomorrowWithTime.getDate() + 1);
        tomorrowWithTime.setHours(hours, minutes, 0, 0);
        newCreatedAt = tomorrowWithTime;
        console.log('Next day hold set to:', newCreatedAt);
      } else {
        // Fallback to midnight if no time provided
        const tomorrowMidnight = new Date();
        tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
        tomorrowMidnight.setHours(0, 0, 0, 0);
        newCreatedAt = tomorrowMidnight;
      }
    }

    // Update order to mark as on hold and change date if next-day
    if (tableName === 'engineering_orders') {
      let query = `UPDATE engineering_orders SET on_hold = ?, hold_info = ?, hold_until = ?, hold_reason = ?`;
      let params = [true, holdInfo, holdUntil, reason || null];
      
      if (newCreatedAt) {
        query += `, created_at = ?`;
        params.push(newCreatedAt);
      }
      
      query += ` WHERE id = ?`;
      params.push(orderId);
      
      await db.query(query, params);
    } else {
      let query = `UPDATE housekeeping_orders SET on_hold = ?, hold_info = ?, hold_until = ?, hold_reason = ?`;
      let params = [true, holdInfo, holdUntil, reason || null];
      
      if (newCreatedAt) {
        query += `, created_at = ?`;
        params.push(newCreatedAt);
      }
      
      query += ` WHERE id = ?`;
      params.push(orderId);
      
      await db.query(query, params);
    }

    // Log the hold action
    const userFullName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}` 
      : user.username;
    
    const logDescription = reason 
      ? `Order put on hold by ${userFullName}: ${holdInfo}. Reason: ${reason}`
      : `Order put on hold by ${userFullName}: ${holdInfo}`;
    
    // Clear any pending reminders for this order
    try {
      await orderNotifications.clearReminders(orderId);
      console.log(`✅ Reminders cleared for order ${orderId} due to hold`);
    } catch (remErr) {
      console.warn('Warning: Could not clear reminders for held order:', remErr.message);
    }
    
    // Fetch the order to get its name for logging
    let orderForLog;
    if (tableName === 'engineering_orders') {
      const result = await db.query(`SELECT order_name FROM engineering_orders WHERE id = ?`, [orderId]);
      orderForLog = result.length > 0 ? result[0] : null;
    } else {
      const result = await db.query(`SELECT order_name FROM housekeeping_orders WHERE id = ?`, [orderId]);
      orderForLog = result.length > 0 ? result[0] : null;
    }
    
    const holdLogData = {
      order_name: orderForLog?.order_name || `Order #${orderId}`,
      on_hold: true,
      hold_info: holdInfo,
      hold_reason: reason || null
    };
    
    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, new_data, change_description)
      VALUES (?, ?, 'hold', ?, ?, ?, ?, ?)
    `, [
      orderId,
      tableName === 'engineering_orders' ? 'engineering' : 'housekeeping',
      user.id,
      userFullName,
      user.hotel_code || user.hotelCode,
      JSON.stringify(holdLogData),
      logDescription
    ]);

    // Fetch the updated order
    let orders;
    if (tableName === 'engineering_orders') {
      orders = await db.query(`
        SELECT o.*, 
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               creator.username as creatorUsername,
               COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
               assignee.username as receiverUsername
        FROM engineering_orders o
        LEFT JOIN users creator ON o.sent_by = creator.id
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.id = ?
      `, [orderId]);
    } else {
      orders = await db.query(`
        SELECT o.*, 
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               creator.username as creatorUsername,
               COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
               assignee.username as receiverUsername
        FROM housekeeping_orders o
        LEFT JOIN users creator ON o.sent_by = creator.id
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.id = ?
      `, [orderId]);
    }

    if (orders.length === 0) {
      console.error('Order not found after update:', orderId);
      return res.status(404).json({ error: 'Order not found' });
    }

    console.log('Order held successfully:', orders[0]);
    res.json({ success: true, order: orders[0] });
  } catch (error) {
    console.error('Hold order error:', error);
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

    const departmentValidation = validation.validateDepartment(department);
    if (!departmentValidation.isValid) {
      return res.status(400).json({ error: departmentValidation.error });
    }

    const sanitizedOrderName = validation.sanitizeString(order_name);
    if (!sanitizedOrderName) {
      return res.status(400).json({ error: 'Order name is required' });
    }

    const notesValidation = validation.validateNotes(order_notes);
    if (!notesValidation.isValid) {
      return res.status(400).json({ error: notesValidation.error });
    }

    // Determine table name based on department
    const tableName = getDepartmentTableName(departmentValidation.value);
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid department' });
    }

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
    `, [sanitizedOrderName, notesValidation.value || null, id]);

    // Get updated order data
    const updatedOrder = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);

    // Log the edit
    const userFullName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}` 
      : user.username;
    
    const changes = [];
    if (oldOrderData.order_name !== sanitizedOrderName) {
      changes.push(`Order name: "${oldOrderData.order_name}" → "${sanitizedOrderName}"`);
    }
    if (oldOrderData.order_notes !== (notesValidation.value || null)) {
      changes.push(`Notes: "${oldOrderData.order_notes || ''}" → "${notesValidation.value || ''}"`);
    }

    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, old_data, new_data, change_description)
      VALUES (?, ?, 'edited', ?, ?, ?, ?, ?, ?)
    `, [
      id,
      getOrderTypeFromTableName(tableName),
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

    const departmentValidation = validation.validateDepartment(department);
    if (!departmentValidation.isValid) {
      return res.status(400).json({ error: departmentValidation.error });
    }

    // Build SQL query to fetch soft-deleted orders
    const tableName = getDepartmentTableName(departmentValidation.value);
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid department' });
    }
    let query = `
      SELECT o.*, 
             COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
             creator.username as creatorUsername,
             COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
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

    const departmentValidation = validation.validateDepartment(department);
    if (!departmentValidation.isValid) {
      return res.status(400).json({ error: departmentValidation.error });
    }

    const sanitizedOrderName = validation.sanitizeString(order_name);
    if (!sanitizedOrderName) {
      return res.status(400).json({ error: 'Order name is required' });
    }

    const notesValidation = validation.validateNotes(order_notes);
    if (!notesValidation.isValid) {
      return res.status(400).json({ error: notesValidation.error });
    }

    // Determine table name based on department
    const tableName = getDepartmentTableName(departmentValidation.value);
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid department' });
    }

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
    `, [sanitizedOrderName, notesValidation.value || null, id]);

    // Get updated order data
    const updatedOrder = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);

    // Log the edit
    const userFullName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}` 
      : user.username;
    
    const changes = [];
    if (oldOrderData.order_name !== sanitizedOrderName) {
      changes.push(`Order name: "${oldOrderData.order_name}" → "${sanitizedOrderName}"`);
    }
    if (oldOrderData.order_notes !== (notesValidation.value || null)) {
      changes.push(`Notes: "${oldOrderData.order_notes || ''}" → "${notesValidation.value || ''}"`);
    }

    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, old_data, new_data, change_description)
      VALUES (?, ?, 'edited', ?, ?, ?, ?, ?, ?)
    `, [
      id,
      getOrderTypeFromTableName(tableName),
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
    const validLogTypes = ['deleted', 'edited', 'restored', 'hold'];

    if (type && !validLogTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid log type' });
    }

    if (date) {
      const dateValidation = validation.validateDate(date);
      if (!dateValidation.isValid) {
        return res.status(400).json({ error: dateValidation.error });
      }
    }

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

    // Get departments for each hotel
    for (const hotel of hotels) {
      const deptRows = await db.query(`
        SELECT department FROM hotel_departments WHERE hotel_code = ?
      `, [hotel.code]);
      hotel.departments = deptRows.map(row => row.department);
    }

    res.json({ hotels });
  } catch (error) {
    console.error('Get hotels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/hotels/:code/departments
 * Get departments for a specific hotel
 * Requires authentication
 */
app.get('/api/hotels/:code/departments', authenticateToken, async (req, res) => {
  try {
    const hotelCode = req.params.code;

    const departments = await db.query(`
      SELECT department FROM hotel_departments WHERE hotel_code = ?
    `, [hotelCode]);

    // If no departments configured, return all departments as fallback
    const deptList = departments.length > 0 
      ? departments.map(row => row.department)
      : ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk'];

    res.json({ departments: deptList });
  } catch (error) {
    console.error('Get hotel departments error:', error);
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
 * GET /api/manager/users
 * List users scoped to the manager's hotel (manager/supervisor/admin)
 * Query params: search (optional)
 */
app.get('/api/manager/users', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];

    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const hotelCode = requester.hotel_code || requester.hotelCode;
    if (!hotelCode) {
      return res.status(400).json({ error: 'Hotel code missing from user profile' });
    }

    const { search = '' } = req.query;
    const searchTerm = search.trim();

    let query = `
      SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role,
             h.name as hotelName
      FROM users u
      LEFT JOIN hotels h ON u.hotel_code = h.code
      WHERE u.hotel_code = ? AND u.role IN ('employee', 'supervisor')
    `;
    const params = [hotelCode];

    if (searchTerm) {
      query += ` AND (u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
      const likeTerm = `%${searchTerm}%`;
      params.push(likeTerm, likeTerm, likeTerm);
    }

    query += ' ORDER BY u.id DESC';

    const users = await db.query(query, params);
    res.json({ users, hotelCode });
  } catch (error) {
    console.error('Manager users fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/manager/reports/daily
 * Returns all orders for the manager's hotel on a specific date (both departments)
 */
app.get('/api/manager/reports/daily', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];

    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const hotelCode = requester.hotel_code || requester.hotelCode;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date is required (YYYY-MM-DD)' });
    }

    const baseFields = `
      o.id,
      o.order_name,
      o.order_notes,
      o.created_at,
      o.completed_at,
      o.on_hold,
      o.hold_info,
      o.hold_until,
      o.hold_reason,
      o.deleted_at,
      o.hotel_code,
      COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
      creator.username as creatorUsername,
      COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username, 'Deleted User') as receiverName,
      assignee.username as receiverUsername,
      CASE
        WHEN o.deleted_at IS NOT NULL THEN 'deleted'
        WHEN o.completed_at IS NOT NULL THEN 'completed'
        WHEN o.on_hold = 1 THEN 'on_hold'
        ELSE 'open'
      END AS status,
      CASE
        WHEN o.completed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.created_at, o.completed_at)
        ELSE NULL
      END AS duration_minutes
    `;

    const engineeringQuery = `
      SELECT 'engineering' as department, ${baseFields}
      FROM engineering_orders o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NULL AND DATE(o.created_at) = ?
    `;

    const housekeepingQuery = `
      SELECT 'housekeeping' as department, ${baseFields}
      FROM housekeeping_orders o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NULL AND DATE(o.created_at) = ?
    `;

    const laundryQuery = `
      SELECT 'laundry' as department, ${baseFields}
      FROM laundry_orders o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NULL AND DATE(o.created_at) = ?
    `;

    const roomserviceQuery = `
      SELECT 'roomservice' as department, ${baseFields}
      FROM roomservice_orders o
      LEFT JOIN users creator ON o.sent_by = creator.id
      LEFT JOIN users assignee ON o.assigned_to = assignee.id
      WHERE o.hotel_code = ? AND o.deleted_at IS NULL AND DATE(o.created_at) = ?
    `;

    const orders = await db.query(`(${engineeringQuery}) UNION ALL (${housekeepingQuery}) UNION ALL (${laundryQuery}) UNION ALL (${roomserviceQuery}) ORDER BY created_at DESC`, [hotelCode, date, hotelCode, date, hotelCode, date, hotelCode, date]);

    res.json({ orders, hotelCode, date });
  } catch (error) {
    console.error('Manager daily report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/manager/users/:id
 * Update a user scoped to the manager's hotel (manager/supervisor/admin)
 */
app.put('/api/manager/users/:id', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];

    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const { id } = req.params;
    const { firstName, lastName, username, password, role, department } = req.body;

    if (!firstName || !lastName || !username) {
      return res.status(400).json({ error: 'First name, last name, and username are required' });
    }

    if (role && !['employee', 'supervisor', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Validate department if provided and role is employee
    const validDepartments = ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk'];
    if (department && role === 'employee' && !validDepartments.includes(department)) {
      return res.status(400).json({ error: 'Invalid department' });
    }

    const hotelCode = requester.hotel_code || requester.hotelCode;

    // Fetch target user and enforce hotel scoping for non-admins
    const targetUser = await db.query(`
      SELECT id, username, hotel_code FROM users WHERE id = ?
    `, [id]);

    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (requester.role !== 'admin' && targetUser[0].hotel_code !== hotelCode) {
      return res.status(403).json({ error: 'Access denied for this hotel' });
    }

    // If employee, validate that department is allowed for the hotel
    if (role === 'employee' && department) {
      const hotelDepts = await db.query(`
        SELECT department FROM hotel_departments WHERE hotel_code = ?
      `, [targetUser[0].hotel_code]);
      
      const allowedDepts = hotelDepts.map(row => row.department);
      if (allowedDepts.length > 0 && !allowedDepts.includes(department)) {
        return res.status(400).json({ 
          error: `Department '${department}' is not available for this hotel. Allowed departments: ${allowedDepts.join(', ')}`
        });
      }
    }

    // Enforce unique username if changed
    if (username !== targetUser[0].username) {
      const existing = await db.query(`SELECT id FROM users WHERE username = ?`, [username]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    let updateQuery = `UPDATE users SET first_name = ?, last_name = ?, username = ?`;
    const params = [firstName, lastName, username];

    if (password && password.trim()) {
      updateQuery += ', passwordHash = ?';
      params.push(password.trim());
    }

    if (role) {
      updateQuery += ', role = ?';
      params.push(role);
    }

    // Set department to NULL if role is not employee
    if (role && role !== 'employee') {
      updateQuery += ', department = NULL';
    } else if (department) {
      updateQuery += ', department = ?';
      params.push(department);
    }

    updateQuery += ' WHERE id = ?';
    params.push(id);

    await db.query(updateQuery, params);

    const updatedUser = await db.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role, u.department, h.name as hotelName
      FROM users u
      LEFT JOIN hotels h ON u.hotel_code = h.code
      WHERE u.id = ?
    `, [id]);

    res.json({ success: true, user: updatedUser[0] });
  } catch (error) {
    console.error('Manager update user error:', error);
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
    const { name, code, departments } = req.body;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate required fields
    if (!name || !code) {
      return res.status(400).json({ error: 'Hotel name and code are required' });
    }

    // Validate departments
    const validDepartments = ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk'];
    if (!departments || !Array.isArray(departments) || departments.length === 0) {
      return res.status(400).json({ error: 'At least one department must be selected' });
    }

    // Check if all selected departments are valid
    const invalidDepts = departments.filter(dept => !validDepartments.includes(dept));
    if (invalidDepts.length > 0) {
      return res.status(400).json({ error: `Invalid departments: ${invalidDepts.join(', ')}` });
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

    // Insert hotel departments
    for (const department of departments) {
      await db.query(`
        INSERT INTO hotel_departments (hotel_code, department)
        VALUES (?, ?)
      `, [code, department]);
    }

    res.json({
      success: true,
      message: 'Hotel created successfully',
      hotel: {
        id: code,
        name,
        code,
        departments
      }
    });
  } catch (error) {
    console.error('Create hotel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/admin/hotels/:id
 * Update hotel information and departments (admin only)
 * Requires authentication and admin role
 */
app.put('/api/admin/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const hotelId = req.params.id;
    const { name, departments } = req.body;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate departments if provided
    const validDepartments = ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk'];
    if (departments) {
      if (!Array.isArray(departments) || departments.length === 0) {
        return res.status(400).json({ error: 'At least one department must be selected' });
      }

      const invalidDepts = departments.filter(dept => !validDepartments.includes(dept));
      if (invalidDepts.length > 0) {
        return res.status(400).json({ error: `Invalid departments: ${invalidDepts.join(', ')}` });
      }
    }

    // Check if hotel exists
    const existingHotels = await db.query(`
      SELECT code FROM hotels WHERE id = ?
    `, [hotelId]);

    if (existingHotels.length === 0) {
      return res.status(404).json({ error: 'Hotel not found' });
    }

    const hotelCode = existingHotels[0].code;

    // Update hotel name if provided
    if (name) {
      await db.query(`
        UPDATE hotels SET name = ?, updatedAt = ? WHERE id = ?
      `, [name, new Date(), hotelId]);
    }

    // Update departments if provided
    if (departments) {
      // Delete existing departments
      await db.query(`
        DELETE FROM hotel_departments WHERE hotel_code = ?
      `, [hotelCode]);

      // Insert new departments
      for (const department of departments) {
        await db.query(`
          INSERT INTO hotel_departments (hotel_code, department)
          VALUES (?, ?)
        `, [hotelCode, department]);
      }
    }

    res.json({
      success: true,
      message: 'Hotel updated successfully'
    });
  } catch (error) {
    console.error('Update hotel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 * Requires authentication and admin role
 * For admin users: hotel code is optional (they can access all hotels)
 * For other users: hotel code is required
 */
app.post('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { firstName, lastName, username, password, hotelCode, role, department } = req.body;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate input
    const usernameValidation = validation.validateUsername(username);
    const passwordValidation = validation.validatePassword(password);

    if (!usernameValidation.isValid) {
      return res.status(400).json({ error: usernameValidation.error });
    }
    if (!passwordValidation.isValid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    // Hotel code is required for non-admin roles, optional for admins
    let hotelCodeValidation = { isValid: true, value: hotelCode };
    if (role !== 'admin') {
      if (!hotelCode) {
        return res.status(400).json({ error: 'Hotel code is required for non-admin users' });
      }
      hotelCodeValidation = validation.validateHotelCode(hotelCode);
      if (!hotelCodeValidation.isValid) {
        return res.status(400).json({ error: hotelCodeValidation.error });
      }
    } else {
      // For admins, hotel code is optional but if provided, validate it
      if (hotelCode) {
        hotelCodeValidation = validation.validateHotelCode(hotelCode);
        if (!hotelCodeValidation.isValid) {
          return res.status(400).json({ error: hotelCodeValidation.error });
        }
      } else {
        // Use a default or null for admin
        hotelCodeValidation.value = hotelCode || null;
      }
    }

    // Validate department if provided and role is employee
    const validDepartments = ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk'];
    if (department && role === 'employee' && !validDepartments.includes(department)) {
      return res.status(400).json({ error: 'Invalid department' });
    }

    // If employee, validate that department is allowed for the hotel
    if (role === 'employee' && department && hotelCodeValidation.value) {
      const hotelDepts = await db.query(`
        SELECT department FROM hotel_departments WHERE hotel_code = ?
      `, [hotelCodeValidation.value]);
      
      const allowedDepts = hotelDepts.map(row => row.department);
      if (allowedDepts.length > 0 && !allowedDepts.includes(department)) {
        return res.status(400).json({ 
          error: `Department '${department}' is not available for this hotel. Allowed departments: ${allowedDepts.join(', ')}`
        });
      }
    }

    // Check if username already exists
    const existingUsers = await db.query(`
      SELECT id FROM users WHERE username = ?
    `, [usernameValidation.value]);

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Create user with plain text password for now (matching existing system)
    // Only set department if role is employee
    const userRole = role || 'employee';
    const userDepartment = (userRole === 'employee' && department) ? department : null;

    const result = await db.query(`
      INSERT INTO users (username, passwordHash, hotel_code, role, first_name, last_name, department, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      usernameValidation.value,
      passwordValidation.value, // Store as plain text for now
      hotelCodeValidation.value,
      userRole,
      firstName,
      lastName,
      userDepartment,
      new Date()
    ]);

    const newUserId = result.insertId;

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
        role: userRole,
        department: userDepartment
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/hotels/:id/check-users
 * Check if a hotel has associated users
 * Used before deletion to warn admin
 */
app.get('/api/admin/hotels/:id/check-users', authenticateToken, async (req, res) => {
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

    // Check if hotel has users
    const hotelUsers = await db.query(`
      SELECT COUNT(*) as userCount FROM users WHERE hotel_code = ?
    `, [hotelCode]);

    res.json({
      hasUsers: hotelUsers[0].userCount > 0,
      userCount: hotelUsers[0].userCount
    });
  } catch (error) {
    console.error('Check hotel users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/hotels/:id
 * Delete a hotel (admin only)
 * Requires authentication and admin role
 * Supports override parameter to delete hotel with all its users
 */
app.delete('/api/admin/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const override = req.query.override === 'true';

    // Check if legacy push_subscriptions table exists (pre-FCM)
    const pushTableCheck = await db.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'push_subscriptions'
    `);
    const hasPushSubscriptions = pushTableCheck[0]?.count > 0;

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

    // If hotel has users and override is not specified, return error
    if (!override && hotelUsers[0].userCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete hotel with existing users. Please reassign or delete users first.',
        hasUsers: true,
        userCount: hotelUsers[0].userCount
      });
    }

    // If override is true, delete all users in this hotel first
    if (override && hotelUsers[0].userCount > 0) {
      // Get all user IDs in this hotel
      const users = await db.query(`
        SELECT id FROM users WHERE hotel_code = ?
      `, [hotelCode]);

      // Delete each user's related data
      for (const userRow of users) {
        const userId = userRow.id;

        // Delete related order logs (FK to users)
        await db.query(`DELETE FROM order_logs WHERE changed_by = ?`, [userId]);

        // Delete all orders related to this user (both created and assigned)
        await db.query(`DELETE FROM engineering_orders WHERE sent_by = ? OR assigned_to = ?`, [userId, userId]);
        await db.query(`DELETE FROM housekeeping_orders WHERE sent_by = ? OR assigned_to = ?`, [userId, userId]);
        await db.query(`DELETE FROM laundry_orders WHERE sent_by = ? OR assigned_to = ?`, [userId, userId]);
        await db.query(`DELETE FROM roomservice_orders WHERE sent_by = ? OR assigned_to = ?`, [userId, userId]);

        // Delete FCM tokens
        await db.query(`DELETE FROM fcm_tokens WHERE user_id = ?`, [userId]);

        // Delete legacy push subscriptions if table exists
        if (hasPushSubscriptions) {
          await db.query(`DELETE FROM push_subscriptions WHERE user_id = ?`, [userId]);
        }
      }

      // Delete notification records tied to this hotel
      await db.query(`DELETE FROM order_notifications WHERE hotel_code = ?`, [hotelCode]);

      // Delete all users in this hotel
      await db.query(`DELETE FROM users WHERE hotel_code = ?`, [hotelCode]);
    }

    // Delete hotel (hotel_departments will cascade delete automatically)
    await db.query(`
      DELETE FROM hotels WHERE id = ?
    `, [id]);

    res.json({
      success: true,
      message: 'Hotel deleted successfully'
    });
  } catch (error) {
    console.error('Delete hotel error:', error);
    console.error('Error details:', error.message, error.code);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update a user (admin only)
 * Requires authentication and admin role
 */
app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { firstName, lastName, username, password, role, department } = req.body;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate input
    if (!firstName || !lastName || !username) {
      return res.status(400).json({ error: 'First name, last name, and username are required' });
    }

    // Validate role if provided
    if (role && !['employee', 'supervisor', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Validate department if provided and role is employee
    const validDepartments = ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk'];
    if (department && role === 'employee' && !validDepartments.includes(department)) {
      return res.status(400).json({ error: 'Invalid department' });
    }

    // Check if target user exists
    const targetUser = await db.query(`
      SELECT id, username, hotel_code FROM users 
      WHERE id = ?
    `, [id]);

    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If employee, validate that department is allowed for the hotel
    if (role === 'employee' && department) {
      const hotelDepts = await db.query(`
        SELECT department FROM hotel_departments WHERE hotel_code = ?
      `, [targetUser[0].hotel_code]);
      
      const allowedDepts = hotelDepts.map(row => row.department);
      if (allowedDepts.length > 0 && !allowedDepts.includes(department)) {
        return res.status(400).json({ 
          error: `Department '${department}' is not available for this hotel. Allowed departments: ${allowedDepts.join(', ')}`
        });
      }
    }

    // Check if new username already exists (only if username changed)
    if (username !== targetUser[0].username) {
      const existingUser = await db.query(`
        SELECT id FROM users WHERE username = ?
      `, [username]);

      if (existingUser.length > 0) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    // Build update query
    let updateQuery = `UPDATE users SET first_name = ?, last_name = ?, username = ?`;
    let updateParams = [firstName, lastName, username];

    // Only update password if provided
    if (password && password.trim()) {
      updateQuery += `, passwordHash = ?`;
      updateParams.push(password);
    }

    // Only update role if provided
    if (role) {
      updateQuery += `, role = ?`;
      updateParams.push(role);
    }

    // Set department to NULL if role is not employee, otherwise update it
    if (role && role !== 'employee') {
      updateQuery += `, department = NULL`;
    } else if (role === 'employee' && department !== undefined) {
      updateQuery += `, department = ?`;
      updateParams.push(department || null);
    }

    updateQuery += ` WHERE id = ?`;
    updateParams.push(id);

    // Execute update
    await db.query(updateQuery, updateParams);

    // Fetch updated user
    const updatedUser = await db.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role, u.department, h.name as hotelName
      FROM users u
      LEFT JOIN hotels h ON u.hotel_code = h.code
      WHERE u.id = ?
    `, [id]);

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/users/:id/check-orders
 * Check if a user has associated orders
 * Used before deletion to warn admin
 */
app.get('/api/admin/users/:id/check-orders', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check if user has orders across all department tables
    const ordersCreated = await db.query(`
      SELECT COUNT(*) as count FROM (
        SELECT id FROM engineering_orders WHERE sent_by = ?
        UNION ALL
        SELECT id FROM housekeeping_orders WHERE sent_by = ?
        UNION ALL
        SELECT id FROM laundry_orders WHERE sent_by = ?
        UNION ALL
        SELECT id FROM roomservice_orders WHERE sent_by = ?
      ) as all_orders
    `, [id, id, id, id]);

    const ordersAssigned = await db.query(`
      SELECT COUNT(*) as count FROM (
        SELECT id FROM engineering_orders WHERE assigned_to = ?
        UNION ALL
        SELECT id FROM housekeeping_orders WHERE assigned_to = ?
        UNION ALL
        SELECT id FROM laundry_orders WHERE assigned_to = ?
        UNION ALL
        SELECT id FROM roomservice_orders WHERE assigned_to = ?
      ) as all_orders
    `, [id, id, id, id]);

    res.json({
      hasOrders: (ordersCreated[0].count > 0 || ordersAssigned[0].count > 0),
      ordersCreated: ordersCreated[0].count,
      ordersAssigned: ordersAssigned[0].count
    });
  } catch (error) {
    console.error('Check orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user (admin only)
 * Requires authentication and admin role
 * Supports override parameter to delete users with orders
 */
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const override = req.query.override === 'true';

    // Check if legacy push_subscriptions table exists (pre-FCM)
    const pushTableCheck = await db.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'push_subscriptions'
    `);
    const hasPushSubscriptions = pushTableCheck[0]?.count > 0;

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

    // Check if user has related data across all department tables
    const ordersCreated = await db.query(`
      SELECT COUNT(*) as count FROM (
        SELECT id FROM engineering_orders WHERE sent_by = ?
        UNION ALL
        SELECT id FROM housekeeping_orders WHERE sent_by = ?
        UNION ALL
        SELECT id FROM laundry_orders WHERE sent_by = ?
        UNION ALL
        SELECT id FROM roomservice_orders WHERE sent_by = ?
      ) as all_orders
    `, [id, id, id, id]);

    const ordersAssigned = await db.query(`
      SELECT COUNT(*) as count FROM (
        SELECT id FROM engineering_orders WHERE assigned_to = ?
        UNION ALL
        SELECT id FROM housekeeping_orders WHERE assigned_to = ?
        UNION ALL
        SELECT id FROM laundry_orders WHERE assigned_to = ?
        UNION ALL
        SELECT id FROM roomservice_orders WHERE assigned_to = ?
      ) as all_orders
    `, [id, id, id, id]);

    // If user has orders and override is not specified, return error with option to override
    if (!override && (ordersCreated[0].count > 0 || ordersAssigned[0].count > 0)) {
      return res.status(400).json({ 
        error: `User has ${ordersCreated[0].count} order(s) created and ${ordersAssigned[0].count} order(s) assigned`,
        hasOrders: true,
        ordersCreated: ordersCreated[0].count,
        ordersAssigned: ordersAssigned[0].count
      });
    }

    // Always handle related data to avoid constraint violations
    // Delete all orders related to this user (both created and assigned)
    await db.query(`DELETE FROM engineering_orders WHERE sent_by = ? OR assigned_to = ?`, [id, id]);
    await db.query(`DELETE FROM housekeeping_orders WHERE sent_by = ? OR assigned_to = ?`, [id, id]);
    await db.query(`DELETE FROM laundry_orders WHERE sent_by = ? OR assigned_to = ?`, [id, id]);
    await db.query(`DELETE FROM roomservice_orders WHERE sent_by = ? OR assigned_to = ?`, [id, id]);

    // Delete related order logs
    await db.query(`DELETE FROM order_logs WHERE changed_by = ?`, [id]);

    // Delete related FCM tokens
    await db.query(`DELETE FROM fcm_tokens WHERE user_id = ?`, [id]);

    // Delete legacy push subscriptions if table exists
    if (hasPushSubscriptions) {
      await db.query(`DELETE FROM push_subscriptions WHERE user_id = ?`, [id]);
    }

    // Delete the user
    await db.query(`DELETE FROM users WHERE id = ?`, [id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user: ' + error.message });
  }
});

/**
 * POST /api/seed
 * Create sample data for development/testing
 * Creates test hotels, users, and orders
 */
app.post('/api/seed', blockDebugRoutesInProduction, async (req, res) => {
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
// NOTIFICATIONS
// ============================================================================

/**
 * GET /api/notifications/pending
 * Get pending notifications for unclaimed orders
 * Checks for orders not received after 3, 5, 8, and 10 minutes
 * Progressive escalation: all roles at 3 mins, 5 mins, 8 mins, and urgent 10 mins for supervisors/managers/admins
 */
app.get('/api/notifications/pending', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const hotelCode = user.hotel_code || user.hotelCode;

    // Check for unclaimed orders in all departments
    const notifications = [];
    const pushMessages = [];

    const departmentMap = {
      'engineering_orders': 'Engineering',
      'housekeeping_orders': 'Housekeeping',
      'laundry_orders': 'Laundry',
      'roomservice_orders': 'Room Service'
    };

    for (const dept of ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders']) {
      const deptName = departmentMap[dept];

      // Find orders created at different time intervals for progressive escalation
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const eightMinAgo = new Date(Date.now() - 8 * 60 * 1000);
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);

      // Level 1 notifications (3 minutes): for all employees in the hotel
      const level1Query = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
          AND o.on_hold = 0
          AND o.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM order_notifications 
            WHERE order_id = o.id 
            AND order_type = ? 
            AND notification_level = 1
          )
        ORDER BY o.created_at ASC
      `;

      const level1Orders = await db.query(level1Query, [
        hotelCode,
        threeMinAgo,
        deptName.toLowerCase()
      ]);

      // Level 2 notifications (5 minutes): for all employees
      const level2Query = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
          AND o.on_hold = 0
          AND o.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM order_notifications 
            WHERE order_id = o.id 
            AND order_type = ? 
            AND notification_level = 2
          )
        ORDER BY o.created_at ASC
      `;

      const level2Orders = await db.query(level2Query, [
        hotelCode,
        fiveMinAgo,
        deptName.toLowerCase()
      ]);

      // Level 3 notifications (8 minutes): for supervisors and managers
      const level3Query = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
          AND o.on_hold = 0
          AND o.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM order_notifications 
            WHERE order_id = o.id 
            AND order_type = ? 
            AND notification_level = 3
          )
        ORDER BY o.created_at ASC
      `;

      const level3Orders = await db.query(level3Query, [
        hotelCode,
        eightMinAgo,
        deptName.toLowerCase()
      ]);

      // Level 4 notifications (10 minutes): URGENT for supervisors and managers
      const level4Query = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
          AND o.on_hold = 0
          AND o.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM order_notifications 
            WHERE order_id = o.id 
            AND order_type = ? 
            AND notification_level = 4
          )
        ORDER BY o.created_at ASC
      `;

      const level4Orders = await db.query(level4Query, [
        hotelCode,
        tenMinAgo,
        deptName.toLowerCase()
      ]);

      // Queue push messages for all levels
      level1Orders.forEach(order => {
        pushMessages.push({
          hotelCode,
          title: '⏰ Pending Order (3 mins)',
          message: `${deptName}: ${order.order_name || `Order #${order.id}`}`,
          data: {
            orderId: order.id,
            department: deptName,
            level: 1
          }
        });
      });

      level2Orders.forEach(order => {
        pushMessages.push({
          hotelCode,
          title: '⏰ Pending Order (5 mins)',
          message: `${deptName}: ${order.order_name || `Order #${order.id}`}`,
          data: {
            orderId: order.id,
            department: deptName,
            level: 2
          }
        });
      });

      level3Orders.forEach(order => {
        pushMessages.push({
          hotelCode,
          title: '⚠️ Unclaimed Order (8 mins)',
          message: `${deptName}: ${order.order_name || `Order #${order.id}`}`,
          data: {
            orderId: order.id,
            department: deptName,
            level: 3
          }
        });
      });

      level4Orders.forEach(order => {
        pushMessages.push({
          hotelCode,
          title: '🚨 URGENT: Unclaimed Order (10 mins)',
          message: `${deptName}: ${order.order_name || `Order #${order.id}`}`,
          data: {
            orderId: order.id,
            department: deptName,
            level: 4
          }
        });
      });

      // Determine which notifications to send based on user role
      let userNotifications = [];

      // For employees, only show their assigned department
      const isFrontDeskUser = isFrontDeskAccessUser(user);
      if (user.role === 'employee' && !isFrontDeskUser) {
        if (user.department !== deptName) {
          continue; // Skip this department for employees not assigned to it
        }

        userNotifications = level1Orders.map(order => ({
          ...order,
          department: deptName,
          level: 1,
          minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
        }));

        userNotifications = userNotifications.concat(
          level2Orders.map(order => ({
            ...order,
            department: deptName,
            level: 2,
            minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
          }))
        );
      } else if (['supervisor', 'manager', 'admin', 'front_desk'].includes(user.role) || isFrontDeskUser) {
        // Supervisors, managers, admins, and front desk get 3-minute and 5-minute alerts
        userNotifications = level1Orders.map(order => ({
          ...order,
          department: deptName,
          level: 1,
          minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
        }));

        userNotifications = userNotifications.concat(
          level2Orders.map(order => ({
            ...order,
            department: deptName,
            level: 2,
            minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
          }))
        );

        // Managers, supervisors, admins, and front desk also get the 8-minute and 10-minute alerts
        userNotifications = userNotifications.concat(
          level3Orders.map(order => ({
            ...order,
            department: deptName,
            level: 3,
            minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
          }))
        );

        userNotifications = userNotifications.concat(
          level4Orders.map(order => ({
            ...order,
            department: deptName,
            level: 4,
            minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
          }))
        );
      }

      notifications.push(...userNotifications);
    }

    // Mark notifications as sent in database
    for (const notif of notifications) {
      try {
        await db.query(`
          INSERT INTO order_notifications (order_id, order_type, hotel_code, notification_level, sent_at)
          VALUES (?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE sent_at = NOW()
        `, [
          notif.id,
          notif.department.toLowerCase(),
          hotelCode,
          notif.level
        ]);
      } catch (error) {
        console.log('Notification already logged or error:', error.message);
      }
    }

    res.json({ notifications });
  } catch (error) {
    console.error('Get pending notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/notifications/new-orders
 * Get newly created orders (created in the last minute)
 * Shows notifications for orders just created
 */
app.get('/api/notifications/new-orders', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const hotelCode = user.hotel_code || user.hotelCode;

    // Check for orders created in the last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    const notifications = [];
    const pushMessages = [];

    const departmentMap = {
      'engineering_orders': 'Engineering',
      'housekeeping_orders': 'Housekeeping',
      'laundry_orders': 'Laundry',
      'roomservice_orders': 'Room Service'
    };

    for (const dept of ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders']) {
      const deptName = departmentMap[dept];

      // For employees, skip departments they're not assigned to
      if (user.role === 'employee' && !isFrontDeskAccessUser(user) && user.department !== deptName) {
        continue;
      }

      // Find newly created orders in this hotel
      const newOrdersQuery = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username, 'Deleted User') as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.deleted_at IS NULL
          AND o.created_at > ?
          AND NOT EXISTS (
            SELECT 1 FROM order_notifications 
            WHERE order_id = o.id 
            AND order_type = ? 
            AND notification_level = 0
          )
        ORDER BY o.created_at DESC
      `;

      const newOrders = await db.query(newOrdersQuery, [
        hotelCode,
        oneMinuteAgo,
        deptName.toLowerCase()
      ]);

      // Queue push messages for new orders
      newOrders.forEach(order => {
        // Don't notify the user who created the order
        if (order.sent_by !== user.id) {
          pushMessages.push({
            hotelCode,
            title: '🆕 New Order Received!',
            message: `${deptName}: ${order.order_name || `Order #${order.id}`}`,
            data: {
              orderId: order.id,
              department: deptName,
              level: 0
            }
          });

          notifications.push({
            ...order,
            department: deptName,
            level: 0,
            minutesOld: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
          });
        }
      });
    }

    // Mark notifications as sent in database
    for (const notif of notifications) {
      try {
        await db.query(`
          INSERT INTO order_notifications (order_id, order_type, hotel_code, notification_level, sent_at)
          VALUES (?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE sent_at = NOW()
        `, [
          notif.id,
          notif.department.toLowerCase(),
          hotelCode,
          notif.level
        ]);
      } catch (error) {
        console.log('Notification already logged or error:', error.message);
      }
    }

    res.json({ notifications });
  } catch (error) {
    console.error('Get new orders notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PUSH NOTIFICATIONS
// ============================================================================

// Old web-push endpoints removed - now using Firebase Cloud Messaging (FCM)
// Push notifications are now sent via routes/fcm.js

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

/**
 * GET /
 * Serve the public landing page
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

/**
 * GET /dashboard
 * Serve the staff dashboard application
 */
app.get('/dashboard', (req, res) => {
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
app.get('/api/debug/data', blockDebugRoutesInProduction, async (req, res) => {
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
app.post('/api/debug/create-user', blockDebugRoutesInProduction, async (req, res) => {
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

// ============================================================================
// CUSTOMER ORDER ENDPOINTS
// ============================================================================

/**
 * GET /api/customer/orders
 * Get all orders submitted by the logged-in customer (across all departments)
 * Requires authentication with role=customer
 */
app.get('/api/customer/orders', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'customer') {
      return res.status(403).json({ error: 'Customer access only' });
    }

    const hotelCode = user.hotel_code || user.hotelCode;
    const baseFields = `
      o.id, o.order_name, o.order_notes, o.created_at, o.completed_at, o.deleted_at,
      o.on_hold, o.hold_info, o.hold_until, o.hold_reason, o.hotel_code,
      o.sent_by, o.assigned_to,
      COALESCE(NULLIF(TRIM(CONCAT(COALESCE(assignee.first_name, ''), ' ', COALESCE(assignee.last_name, ''))), ''), assignee.username, NULL) as receiverName,
      assignee.username as receiverUsername
    `;

    const rows = await db.query(`
      (SELECT 'Engineering' as department, ${baseFields} FROM engineering_orders o
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.sent_by = ? AND o.hotel_code = ?)
      UNION ALL
      (SELECT 'Housekeeping' as department, ${baseFields} FROM housekeeping_orders o
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.sent_by = ? AND o.hotel_code = ?)
      UNION ALL
      (SELECT 'Laundry' as department, ${baseFields} FROM laundry_orders o
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.sent_by = ? AND o.hotel_code = ?)
      UNION ALL
      (SELECT 'Room Service' as department, ${baseFields} FROM roomservice_orders o
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.sent_by = ? AND o.hotel_code = ?)
      ORDER BY created_at DESC
    `, [
      user.id, hotelCode,
      user.id, hotelCode,
      user.id, hotelCode,
      user.id, hotelCode
    ]);

    res.json({ orders: rows });
  } catch (error) {
    console.error('Customer orders fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/customer/orders
 * Submit a new service request as a customer
 * Body: { department, notes }
 * The room number comes from the customer's profile
 */
app.post('/api/customer/orders', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'customer') {
      return res.status(403).json({ error: 'Customer access only' });
    }

    const { department, notes } = req.body;
    if (!department) {
      return res.status(400).json({ error: 'Department is required' });
    }

    const deptValidation = validation.validateDepartment(department);
    if (!deptValidation.isValid) {
      return res.status(400).json({ error: deptValidation.error });
    }

    const notesValidation = validation.validateNotes(notes);
    if (!notesValidation.isValid) {
      return res.status(400).json({ error: notesValidation.error });
    }

    const hotelCode = user.hotel_code || user.hotelCode;
    const roomNumber = user.room_number || user.username;
    const tableName = getDepartmentTableName(deptValidation.value);
    const orderName = `Room ${roomNumber}`;

    const result = await db.query(`
      INSERT INTO ${tableName} (order_name, order_notes, sent_by, created_at, hotel_code)
      VALUES (?, ?, ?, NOW(), ?)
    `, [orderName, notesValidation.value || '', user.id, hotelCode]);

    const orderId = result.insertId;

    const orders = await db.query(`
      SELECT o.*, '${deptValidation.value}' as department FROM ${tableName} o WHERE o.id = ?
    `, [orderId]);

    // Notify hotel staff via FCM
    try {
      const hotelUsers = await db.query(
        `SELECT id FROM users WHERE hotel_code = ? AND id != ? AND role != 'customer'`,
        [hotelCode, user.id]
      );
      if (hotelUsers && hotelUsers.length > 0) {
        const userIds = hotelUsers.map(u => u.id);
        await fcmRoutes.sendFCMNotification(userIds, {
          title: '🆕 New Guest Request',
          body: `${deptValidation.value}: ${orderName}`,
          data: {
            orderId: orderId.toString(),
            department: deptValidation.value,
            type: 'new_order'
          }
        });
      }
    } catch (fcmErr) {
      console.warn('FCM notification for customer order failed:', fcmErr.message);
    }

    // Schedule reminders
    try {
      await orderNotifications.scheduleReminders(orderId, deptValidation.value.toLowerCase(), hotelCode, {
        roomNumber,
        notes: notesValidation.value || ''
      });
    } catch (remErr) {
      console.warn('Reminder scheduling failed:', remErr.message);
    }

    res.json({ order: orders[0] });
  } catch (error) {
    console.error('Customer create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/customer/orders/:id
 * Cancel a customer's own order — reason is mandatory
 */
app.delete('/api/customer/orders/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'customer') {
      return res.status(403).json({ error: 'Customer access only' });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A cancellation reason is required.' });
    }

    const hotelCode = user.hotel_code || user.hotelCode;
    const tableNames = ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders'];
    let tableName = null;

    for (const tbl of tableNames) {
      const rows = await db.query(
        `SELECT id, sent_by, completed_at FROM ${tbl} WHERE id = ? AND hotel_code = ? AND deleted_at IS NULL`,
        [id, hotelCode]
      );
      if (rows.length > 0) {
        if (rows[0].sent_by !== user.id) {
          return res.status(403).json({ error: 'You can only cancel your own orders.' });
        }
        if (rows[0].completed_at) {
          return res.status(400).json({ error: 'Cannot cancel a completed order.' });
        }
        tableName = tbl;
        break;
      }
    }

    if (!tableName) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const orderData = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
    orderNotifications.clearReminders(id);

    await db.query(`UPDATE ${tableName} SET deleted_at = NOW() WHERE id = ?`, [id]);

    const userFullName = user.room_number ? `Room ${user.room_number}` : user.username;
    await db.query(`
      INSERT INTO order_logs (order_id, order_type, action_type, changed_by, changed_by_name, hotel_code, old_data, change_description)
      VALUES (?, ?, 'cancelled', ?, ?, ?, ?, ?)
    `, [
      id,
      getOrderTypeFromTableName(tableName),
      user.id,
      userFullName,
      hotelCode,
      JSON.stringify(orderData[0]),
      `Order cancelled by ${userFullName} - Reason: ${reason.trim()}`
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Customer cancel order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// ROOM USER MANAGEMENT (Manager/Admin)
// ============================================================================

/**
 * GET /api/manager/rooms
 * Get all customer/room accounts for the manager's hotel
 */
app.get('/api/manager/rooms', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];
    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const hotelCode = requester.hotel_code || requester.hotelCode;
    const { search = '' } = req.query;
    const searchTerm = search.trim();

    let query = `
      SELECT u.id, u.username, u.room_number, u.hotel_code, u.role, u.createdAt
      FROM users u
      WHERE u.hotel_code = ? AND u.role = 'customer'
    `;
    const params = [hotelCode];

    if (searchTerm) {
      query += ` AND (u.username LIKE ? OR u.room_number LIKE ?)`;
      const like = `%${searchTerm}%`;
      params.push(like, like);
    }

    query += ' ORDER BY u.room_number ASC, u.createdAt ASC';

    const rooms = await db.query(query, params);
    res.json({ rooms, hotelCode });
  } catch (error) {
    console.error('Manager rooms fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/manager/rooms/bulk-create
 * Create multiple room customer accounts at once
 * Body: { roomNumbers: string (comma/newline separated), password: string }
 */
app.post('/api/manager/rooms/bulk-create', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];
    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const { roomNumbers, password } = req.body;

    if (!roomNumbers || !roomNumbers.trim()) {
      return res.status(400).json({ error: 'Room numbers are required.' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    const hotelCode = requester.hotel_code || requester.hotelCode;

    // Parse room numbers: support comma, newline, space separation
    const parsed = roomNumbers
      .split(/[\n,\s]+/)
      .map(r => r.trim())
      .filter(r => r.length > 0 && /^[A-Za-z0-9\-]{1,20}$/.test(r));

    if (parsed.length === 0) {
      return res.status(400).json({ error: 'No valid room numbers provided.' });
    }
    if (parsed.length > 200) {
      return res.status(400).json({ error: 'Cannot create more than 200 rooms at once.' });
    }

    const created = [];
    const skipped = [];

    for (const roomNum of parsed) {
      const username = `room_${roomNum}`;
      // Check if already exists
      const existing = await db.query('SELECT id FROM users WHERE username = ? AND hotel_code = ?', [username, hotelCode]);
      if (existing.length > 0) {
        skipped.push(roomNum);
        continue;
      }
      await db.query(`
        INSERT INTO users (username, passwordHash, hotel_code, role, room_number, first_name, last_name, createdAt, updatedAt)
        VALUES (?, ?, ?, 'customer', ?, ?, '', NOW(), NOW())
      `, [username, password, hotelCode, roomNum, `Room ${roomNum}`]);
      created.push(roomNum);
    }

    res.json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      createdRooms: created,
      skippedRooms: skipped,
      message: `Created ${created.length} room account(s). ${skipped.length > 0 ? `Skipped ${skipped.length} (already exist).` : ''}`
    });
  } catch (error) {
    console.error('Bulk create rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/manager/rooms/:id
 * Update a room customer account (room number and/or password)
 */
app.put('/api/manager/rooms/:id', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];
    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const { id } = req.params;
    const { roomNumber, password } = req.body;
    const hotelCode = requester.hotel_code || requester.hotelCode;

    // Find the room user
    const target = await db.query('SELECT id, hotel_code, role FROM users WHERE id = ? AND role = ?', [id, 'customer']);
    if (target.length === 0) {
      return res.status(404).json({ error: 'Room account not found.' });
    }
    if (requester.role !== 'admin' && target[0].hotel_code !== hotelCode) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (roomNumber && !/^[A-Za-z0-9\-]{1,20}$/.test(roomNumber.trim())) {
      return res.status(400).json({ error: 'Invalid room number format.' });
    }

    let query = 'UPDATE users SET updatedAt = NOW()';
    const params = [];

    if (roomNumber && roomNumber.trim()) {
      const rn = roomNumber.trim();
      query += ', room_number = ?, username = ?, first_name = ?';
      params.push(rn, `room_${rn}`, `Room ${rn}`);
    }
    if (password && password.trim()) {
      if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters.' });
      }
      query += ', passwordHash = ?';
      params.push(password.trim());
    }

    if (params.length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.query(query, params);

    const updated = await db.query('SELECT id, username, room_number, role, hotel_code FROM users WHERE id = ?', [id]);
    res.json({ success: true, room: updated[0] });
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/manager/rooms/:id
 * Delete a room customer account
 */
app.delete('/api/manager/rooms/:id', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];
    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const { id } = req.params;
    const hotelCode = requester.hotel_code || requester.hotelCode;

    const target = await db.query('SELECT id, hotel_code, role FROM users WHERE id = ? AND role = ?', [id, 'customer']);
    if (target.length === 0) {
      return res.status(404).json({ error: 'Room account not found.' });
    }
    if (requester.role !== 'admin' && target[0].hotel_code !== hotelCode) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Soft-delete all their pending orders before removing the user
    const tbls = ['engineering_orders', 'housekeeping_orders', 'laundry_orders', 'roomservice_orders'];
    for (const tbl of tbls) {
      await db.query(`UPDATE ${tbl} SET deleted_at = NOW() WHERE sent_by = ? AND deleted_at IS NULL AND completed_at IS NULL`, [id]);
    }

    await db.query('DELETE FROM fcm_tokens WHERE user_id = ?', [id]);
    await db.query('DELETE FROM users WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/manager/rooms/bulk-password
 * Reset password for all room accounts in the hotel
 */
app.put('/api/manager/rooms/bulk-password', authenticateToken, async (req, res) => {
  try {
    const requester = req.user;
    const allowedRoles = ['manager', 'supervisor', 'admin'];
    if (!allowedRoles.includes(requester.role)) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const { password } = req.body;
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    const hotelCode = requester.hotel_code || requester.hotelCode;
    const result = await db.query(
      `UPDATE users SET passwordHash = ?, updatedAt = NOW() WHERE hotel_code = ? AND role = 'customer'`,
      [password.trim(), hotelCode]
    );

    res.json({ success: true, updated: result.affectedRows });
  } catch (error) {
    console.error('Bulk password update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function isTransientDbError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || '').toUpperCase();
  return ['ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(code);
}

async function runDatabaseConnectivityDiagnostics() {
  const host = config.db.host;
  const port = config.db.port;

  console.log(`🧪 DB diagnostics: host=${host}, port=${port}, db=${config.db.database}, ssl=${config.db.ssl ? 'on' : 'off'}`);

  try {
    const records = await dns.lookup(host, { all: true });
    const resolved = records.map(r => `${r.address}/${r.family === 6 ? 'IPv6' : 'IPv4'}`).join(', ');
    console.log(`✅ DNS resolved ${host} -> ${resolved}`);
  } catch (error) {
    console.error(`❌ DNS lookup failed for ${host}:`, error.code || error.message);
    return;
  }

  // Best-effort TCP probe for deploy logs when shell access is unavailable.
  await new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (ok) {
        console.log(`✅ TCP probe succeeded to ${host}:${port}`);
      } else {
        console.error(`❌ TCP probe failed to ${host}:${port}: ${detail}`);
      }
      resolve();
    };

    socket.setTimeout(5000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', err => finish(false, err.code || err.message));
    socket.connect(port, host);
  });
}

async function connectWithRetry(maxAttempts = 8) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.connect();
      return;
    } catch (error) {
      lastError = error;

      if (!isTransientDbError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(30000, 2000 * attempt);
      console.error(`⚠️ DB connection attempt ${attempt}/${maxAttempts} failed (${error.code || 'UNKNOWN'}). Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

async function startServer() {
  try {
    await runDatabaseConnectivityDiagnostics();

    // Connect to database
    await connectWithRetry();

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