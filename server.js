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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'roomaid-session-secret',
  resave: false,
  saveUninitialized: false
}));

// Serve static assets
app.use(express.static('public'));

// Initialize FCM routes
fcmRoutes.createFCMRoutes(app);

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
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
               creator.username as creatorUsername,
               COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
               assignee.username as receiverUsername
        FROM engineering_orders o
        LEFT JOIN users creator ON o.sent_by = creator.id
        LEFT JOIN users assignee ON o.assigned_to = assignee.id
        WHERE o.id = ?
      `, [orderId]);
    } else {
      orders = await db.query(`
        SELECT o.*, 
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
               creator.username as creatorUsername,
               COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
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
      COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
      creator.username as creatorUsername,
      COALESCE(CONCAT(assignee.first_name, ' ', assignee.last_name), assignee.username) as receiverName,
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

    const orders = await db.query(`(${engineeringQuery}) UNION ALL (${housekeepingQuery}) ORDER BY created_at DESC`, [hotelCode, date, hotelCode, date]);

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
    const { firstName, lastName, username, password, role } = req.body;

    if (!firstName || !lastName || !username) {
      return res.status(400).json({ error: 'First name, last name, and username are required' });
    }

    if (role && !['employee', 'supervisor', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
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

    updateQuery += ' WHERE id = ?';
    params.push(id);

    await db.query(updateQuery, params);

    const updatedUser = await db.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role, h.name as hotelName
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
 * PUT /api/admin/users/:id
 * Update a user (admin only)
 * Requires authentication and admin role
 */
app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { firstName, lastName, username, password, role } = req.body;

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

    // Check if target user exists
    const targetUser = await db.query(`
      SELECT id, username FROM users 
      WHERE id = ?
    `, [id]);

    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
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

    updateQuery += ` WHERE id = ?`;
    updateParams.push(id);

    // Execute update
    await db.query(updateQuery, updateParams);

    // Fetch updated user
    const updatedUser = await db.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.hotel_code, u.role, h.name as hotelName
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

    // Check for unclaimed orders in both departments
    const notifications = [];
    const pushMessages = [];

    for (const dept of ['engineering_orders', 'housekeeping_orders']) {
      const deptName = dept === 'engineering_orders' ? 'Engineering' : 'Housekeeping';

      // Find orders created at different time intervals for progressive escalation
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const eightMinAgo = new Date(Date.now() - 8 * 60 * 1000);
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);

      // Level 1 notifications (3 minutes): for all employees in the hotel
      const level1Query = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
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
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
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
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
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
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
               '${deptName}' as department
        FROM ${dept} o
        LEFT JOIN users creator ON o.sent_by = creator.id
        WHERE o.hotel_code = ? 
          AND o.assigned_to IS NULL 
          AND o.deleted_at IS NULL
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

      // All roles get 3-minute and 5-minute alerts
      if (['employee', 'supervisor', 'manager', 'admin'].includes(user.role)) {
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
      }

      // Managers, supervisors, and admins get the 8-minute and 10-minute alerts
      if (['supervisor', 'manager', 'admin'].includes(user.role)) {
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

    for (const dept of ['engineering_orders', 'housekeeping_orders']) {
      const deptName = dept === 'engineering_orders' ? 'Engineering' : 'Housekeeping';

      // Find newly created orders in this hotel
      const newOrdersQuery = `
        SELECT o.id, o.order_name, o.order_notes, o.sent_by, o.created_at,
               COALESCE(CONCAT(creator.first_name, ' ', creator.last_name), creator.username) as creatorName,
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