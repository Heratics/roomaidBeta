/**
 * Order Notification Utilities
 * Handles automatic notifications and reminders for orders
 */

const db = require('../database');
const { sendFCMNotification } = require('../routes/fcm');

// Store reminder timeouts
const reminderTimeouts = new Map();

/**
 * Send notification to user about new order
 */
async function notifyNewOrder(orderId, department, hotelCode, orderDetails) {
    try {
        console.log(`Sending new order notification for order ${orderId} to ${department} department`);
        
        // Get all users in the department for this hotel
        // For employees, only those assigned to this department
        // For supervisors/managers/admins, all of them get notified
        const users = await db.query(`
            SELECT id FROM users 
            WHERE hotel_code = ?
            AND (role != 'employee' OR department = ?)
        `, [hotelCode, department]);
        
        if (!users || users.length === 0) {
            console.log(`No users found for hotel ${hotelCode} in department ${department}`);
            return;
        }
        
        // Send FCM notification to relevant users
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
            await sendFCMNotification(userIds, {
                title: '🆕 New Order Received!',
                body: `Room ${orderDetails.roomNumber || 'N/A'}: ${orderDetails.notes || 'Service Request'}`,
                data: {
                    url: '/',
                    urgent: 'false',
                    orderId: String(orderId),
                    type: 'order-notification',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        // Schedule reminder notifications
        scheduleReminders(orderId, department, hotelCode, orderDetails);
        
    } catch (error) {
        console.error('Error sending new order notification:', error);
    }
}

/**
 * Schedule reminder notifications
 */
function scheduleReminders(orderId, department, hotelCode, orderDetails) {
    // Clear any existing reminders for this order
    clearReminders(orderId);
    
    const reminderTimes = [
        { minutes: 3, message: '⏰ Reminder: Order not accepted yet' },
        { minutes: 5, message: '⚠️ Urgent: Please accept the order' },
        { minutes: 8, message: '🔴 Critical: Order still pending' },
        { minutes: 12, message: '🚨 Very Urgent: Order needs attention!' }
    ];
    
    const timeouts = [];
    
    reminderTimes.forEach(({ minutes, message }) => {
        const timeout = setTimeout(async () => {
            const pending = await isOrderStillPending(orderId);
            
            if (pending) {
                console.log(`Sending ${minutes}-minute reminder for order ${orderId}`);
                
                try {
                    // Get users for notifications - filter by department for employees
                    let query = `
                        SELECT id FROM users 
                        WHERE hotel_code = ?
                    `;
                    const params = [hotelCode];

                    // For employees, only notify those assigned to this department
                    // For supervisors/managers/admins, notify all
                    query += ` AND (role != 'employee' OR department = ?)`;
                    params.push(department);

                    const users = await db.query(query, params);

                    const userIds = users.map(u => u.id);
                    if (userIds.length > 0) {
                        await sendFCMNotification(userIds, {
                            title: message,
                            body: `Room ${orderDetails.roomNumber || 'N/A'}: ${orderDetails.notes || 'Service Request'} - ${minutes} minutes old`,
                            data: {
                                url: '/',
                                urgent: String(minutes >= 8),
                                orderId: String(orderId),
                                type: 'order-reminder',
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                } catch (error) {
                    console.error(`Error sending ${minutes}-minute reminder:`, error);
                }
            } else {
                console.log(`Order ${orderId} no longer pending, skipping ${minutes}-minute reminder`);
                clearReminders(orderId);
            }
        }, minutes * 60 * 1000); // Convert minutes to milliseconds
        
        timeouts.push(timeout);
    });
    
    // Schedule supervisor notification after 15 minutes
    const supervisorTimeout = setTimeout(async () => {
        const pending = await isOrderStillPending(orderId);
        
        if (pending) {
            console.log(`Order ${orderId} still pending after 15 minutes, notifying supervisors`);
            
            try {
                // Get all supervisors/managers/admins for the hotel
                const supervisors = await db.query(`
                    SELECT id FROM users 
                    WHERE hotel_code = ? AND role IN ('supervisor', 'manager', 'admin')
                `, [hotelCode]);

                const supervisorIds = supervisors.map(s => s.id);
                if (supervisorIds.length > 0) {
                    await sendFCMNotification(supervisorIds, {
                        title: '🚨 URGENT: Unaccepted Order Alert',
                        body: `Order #${orderId} in Room ${orderDetails.roomNumber || 'N/A'} has not been accepted for 15 minutes!`,
                        data: {
                            url: '/',
                            urgent: 'true',
                            orderId: String(orderId),
                            type: 'order-escalation',
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            } catch (error) {
                console.error('Error sending supervisor notification:', error);
            }
        } else {
            console.log(`Order ${orderId} no longer pending at 15 minutes, skipping supervisor notification`);
            clearReminders(orderId);
        }
    }, 15 * 60 * 1000); // 15 minutes
    
    timeouts.push(supervisorTimeout);
    
    // Store all timeouts
    reminderTimeouts.set(orderId, timeouts);
}

/**
 * FCM-based notifications are handled via routes/fcm.js
 */

/**
 * Clear all reminders for an order (called when order is accepted)
 */
function clearReminders(orderId) {
    if (reminderTimeouts.has(orderId)) {
        const timeouts = reminderTimeouts.get(orderId);
        timeouts.forEach(timeout => clearTimeout(timeout));
        reminderTimeouts.delete(orderId);
        console.log(`✅ Cleared all reminders for order ${orderId}`);
    }
}

// Periodic safety net: every 30s clear reminders for orders that are no longer pending/deleted
setInterval(async () => {
    const ids = Array.from(reminderTimeouts.keys());
    for (const id of ids) {
        const pending = await isOrderStillPending(id);
        if (!pending) {
            console.log(`🔍 Cleanup: clearing reminders for non-pending/deleted order ${id}`);
            clearReminders(id);
        }
    }
}, 30 * 1000);

/**
 * Get order status from database
 */
async function getOrderStatus(orderId) {
    try {
        const results = await db.query(`
            SELECT * FROM engineering_orders WHERE id = ? AND deleted_at IS NULL
            UNION ALL
            SELECT * FROM housekeeping_orders WHERE id = ? AND deleted_at IS NULL
            UNION ALL
            SELECT * FROM laundry_orders WHERE id = ? AND deleted_at IS NULL
            UNION ALL
            SELECT * FROM roomservice_orders WHERE id = ? AND deleted_at IS NULL
        `, [orderId, orderId, orderId, orderId]);
        
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('Error getting order status:', error);
        return null;
    }
}

async function isOrderStillPending(orderId) {
    const order = await getOrderStatus(orderId);
    return Boolean(order && !order.assigned_to && !order.completed_at && !order.on_hold);
}

/**
 * Handle order acceptance (clear reminders)
 */
async function handleOrderAcceptance(orderId) {
    console.log(`Order ${orderId} accepted, clearing reminders`);
    clearReminders(orderId);
}

/**
 * Handle order completion (clear reminders)
 */
async function handleOrderCompletion(orderId) {
    console.log(`Order ${orderId} completed, clearing reminders`);
    clearReminders(orderId);
}

module.exports = {
    notifyNewOrder,
    scheduleReminders,
    clearReminders,
    handleOrderAcceptance,
    handleOrderCompletion
};
