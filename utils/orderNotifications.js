/**
 * Order Notification Utilities
 * Handles automatic notifications and reminders for orders
 */

const db = require('../database');
const notificationRoutes = require('../routes/notifications');

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
        
        // Send notification to each user
        for (const user of users) {
            try {
                const subscriptions = await db.query(`
                    SELECT * FROM notf 
                    WHERE user_id = ? 
                    ORDER BY created_at DESC 
                    LIMIT 1
                `, [user.id]);
                
                const subscription = subscriptions.length > 0 ? subscriptions[0] : null;
                
                if (subscription) {
                    await sendPushNotification(subscription, {
                        title: '🆕 New Order Received!',
                        body: `Room ${orderDetails.roomNumber || 'N/A'}: ${orderDetails.notes || 'Service Request'}`,
                        url: '/',
                        urgent: false,
                        orderId: orderId
                    });
                }
            } catch (err) {
                console.error(`Error sending notification to user ${user.id}:`, err);
            }
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
                    
                    for (const user of users) {
                        const subscriptions = await db.query(`
                            SELECT * FROM notf 
                            WHERE user_id = ? 
                            ORDER BY created_at DESC 
                            LIMIT 1
                        `, [user.id]);
                        
                        const subscription = subscriptions.length > 0 ? subscriptions[0] : null;
                        
                        if (subscription) {
                            await sendPushNotification(subscription, {
                                title: message,
                                body: `Room ${orderDetails.roomNumber || 'N/A'}: ${orderDetails.notes || 'Service Request'} - ${minutes} minutes old`,
                                url: '/',
                                urgent: minutes >= 8,
                                orderId: orderId
                            });
                        }
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
                
                for (const supervisor of supervisors) {
                    const subscriptions = await db.query(`
                        SELECT * FROM notf 
                        WHERE user_id = ? 
                        ORDER BY created_at DESC 
                        LIMIT 1
                    `, [supervisor.id]);
                    
                    const subscription = subscriptions.length > 0 ? subscriptions[0] : null;
                    
                    if (subscription) {
                        await sendPushNotification(subscription, {
                            title: '🚨 URGENT: Unaccepted Order Alert',
                            body: `Order #${orderId} in Room ${orderDetails.roomNumber || 'N/A'} has not been accepted for 15 minutes!`,
                            url: '/',
                            urgent: true,
                            orderId: orderId,
                            requireInteraction: true
                        });
                    }
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
 * Send push notification helper
 */
async function sendPushNotification(subscription, data) {
    const webpush = require('web-push');
    
    const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: subscription.p256dh_key,
            auth: subscription.auth_key
        }
    };
    
    const payload = JSON.stringify({
        title: data.title,
        body: data.body,
        url: data.url || '/',
        urgent: data.urgent || false,
        orderId: data.orderId || null,
        type: data.type || 'order-notification',
        requireInteraction: data.requireInteraction || false,
        timestamp: new Date().toISOString()
    });
    
    try {
        await webpush.sendNotification(pushSubscription, payload);
    } catch (error) {
        console.error('Error sending push notification:', error);
        // If subscription is invalid, remove it
        if (error.statusCode === 410) {
            await db.query('DELETE FROM notf WHERE user_id = ?', [subscription.user_id]);
        }
        throw error;
    }
}

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
