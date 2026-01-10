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
        const users = await db.query(`
            SELECT id FROM users 
            WHERE hotel_code = ?
        `, [hotelCode]);
        
        if (!users || users.length === 0) {
            console.log(`No users found for hotel ${hotelCode}`);
            return;
        }
        
        // Send FCM notification to all users in the hotel
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
            await sendFCMNotification(userIds, {
                title: '🆕 New Order Received!',
                body: `Room ${orderDetails.roomNumber || 'N/A'}: ${orderDetails.notes || 'Service Request'}`,
                data: {
                    url: '/',
                    urgent: false,
                    orderId: orderId,
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
        { minutes: 10, message: '🚨 Very Urgent: Order needs attention!' }
    ];
    
    const timeouts = [];
    
    reminderTimes.forEach(({ minutes, message }) => {
        const timeout = setTimeout(async () => {
            // Check if order is still unaccepted
            const order = await getOrderStatus(orderId);
            
            if (order && !order.assigned_to) {
                console.log(`Sending ${minutes}-minute reminder for order ${orderId}`);
                
                try {
                    // Get all users in the department
                    const users = await db.query(`
                        SELECT id FROM users 
                        WHERE hotel_code = ?
                    `, [hotelCode]);

                    const userIds = users.map(u => u.id);
                    if (userIds.length > 0) {
                        await sendFCMNotification(userIds, {
                            title: message,
                            body: `Room ${orderDetails.roomNumber || 'N/A'}: ${orderDetails.notes || 'Service Request'} - ${minutes} minutes old`,
                            data: {
                                url: '/',
                                urgent: minutes >= 8,
                                orderId: orderId,
                                type: 'order-reminder',
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                } catch (error) {
                    console.error(`Error sending ${minutes}-minute reminder:`, error);
                }
            } else {
                console.log(`Order ${orderId} already accepted, skipping ${minutes}-minute reminder`);
            }
        }, minutes * 60 * 1000); // Convert minutes to milliseconds
        
        timeouts.push(timeout);
    });
    
    // Schedule supervisor notification after 15 minutes
    const supervisorTimeout = setTimeout(async () => {
        const order = await getOrderStatus(orderId);
        
        if (order && !order.assigned_to) {
            console.log(`Order ${orderId} still pending after 15 minutes, notifying supervisors`);
            
            try {
                // Get all admin users for the hotel
                const supervisors = await db.query(`
                    SELECT id FROM users 
                    WHERE hotel_code = ? AND role = 'admin'
                `, [hotelCode]);

                const supervisorIds = supervisors.map(s => s.id);
                if (supervisorIds.length > 0) {
                    await sendFCMNotification(supervisorIds, {
                        title: '🚨 URGENT: Unaccepted Order Alert',
                        body: `Order #${orderId} in Room ${orderDetails.roomNumber || 'N/A'} has not been accepted for 15 minutes!`,
                        data: {
                            url: '/',
                            urgent: true,
                            orderId: orderId,
                            type: 'order-escalation',
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            } catch (error) {
                console.error('Error sending supervisor notification:', error);
            }
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

/**
 * Get order status from database
 */
async function getOrderStatus(orderId) {
    try {
        const results = await db.query(`
            SELECT * FROM engineering_orders WHERE id = ?
            UNION ALL
            SELECT * FROM housekeeping_orders WHERE id = ?
        `, [orderId, orderId]);
        
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('Error getting order status:', error);
        return null;
    }
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
