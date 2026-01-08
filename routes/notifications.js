/**
 * Notification Routes for Push Notifications
 * Handles push notification subscriptions and sending
 */

const webpush = require('web-push');
const db = require('../database');
const auth = require('../auth');
const crypto = require('crypto');

// Generate a hash of the VAPID public key to identify key changes
function getVapidKeyHash(publicKey) {
    if (!publicKey) return null;
    return crypto.createHash('sha256').update(publicKey).digest('hex').substring(0, 16);
}

// VAPID keys configuration (read from .env file)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL;

// Configure web-push only if keys are available
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        VAPID_EMAIL,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push configured with VAPID keys');
    
    // Automatically clean up subscriptions with mismatched VAPID keys
    const currentKeyHash = getVapidKeyHash(VAPID_PUBLIC_KEY);
    setTimeout(async () => {
        try {
            // Delete subscriptions that either have no hash (old) or don't match current key
            const result = await db.query(
                'DELETE FROM notf WHERE vapid_key_hash IS NULL OR vapid_key_hash != ?',
                [currentKeyHash]
            );
            if (result.affectedRows > 0) {
                console.log(`🔄 Cleaned up ${result.affectedRows} outdated push subscriptions (VAPID key changed)`);
            }
        } catch (error) {
            console.error('Error cleaning up outdated subscriptions:', error);
        }
    }, 2000); // Wait 2 seconds after startup
} else {
    console.warn('⚠️  VAPID keys not configured. Push notifications will not work.');
}

/**
 * Get VAPID public key
 */
async function getVapidPublicKey(req, res) {
    if (!VAPID_PUBLIC_KEY) {
        return res.status(500).json({ error: 'VAPID keys not configured' });
    }
    res.json({ publicKey: VAPID_PUBLIC_KEY });
}

/**
 * Subscribe to push notifications
 */
async function subscribe(req, res) {
    const { subscription, userId, hotelCode } = req.body;
    
    if (!subscription || !userId) {
        return res.status(400).json({ error: 'Subscription and userId required' });
    }
    
    try {
        // Check if subscription already exists
        const existing = await db.query(`
            SELECT * FROM notf WHERE user_id = ? AND endpoint = ?
        `, [userId, subscription.endpoint]);
        
        const vapidKeyHash = getVapidKeyHash(VAPID_PUBLIC_KEY);
        
        if (existing.length > 0) {
            // Update existing subscription
            await db.query(`
                UPDATE notf SET 
                  p256dh_key = ?, 
                  auth_key = ?, 
                  vapid_key_hash = ?,
                  updated_at = NOW()
                WHERE user_id = ? AND endpoint = ?
            `, [subscription.keys.p256dh, subscription.keys.auth, vapidKeyHash, userId, subscription.endpoint]);
        } else {
            // Insert new subscription
            await db.query(`
                INSERT INTO notf 
                (user_id, hotel_code, endpoint, p256dh_key, auth_key, vapid_key_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [userId, hotelCode, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, vapidKeyHash]);
        }
        
        console.log(`✅ Push subscription saved for user ${userId}`);
        res.json({ 
            success: true, 
            message: 'Subscription saved'
        });
        
    } catch (error) {
        console.error('Error saving push subscription:', error);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
}

/**
 * Send notification to specific user
 */
async function sendNotification(req, res) {
    const { userId, title, body, url, urgent, orderId } = req.body;
    
    if (!userId || !title || !body) {
        return res.status(400).json({ error: 'userId, title, and body required' });
    }
    
    try {
        // Get user's push subscription
        const subscriptions = await db.query(`
            SELECT * FROM notf 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [userId]);
        
        const subscription = subscriptions.length > 0 ? subscriptions[0] : null;
        
        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found for user' });
        }
        
        const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh_key,
                auth: subscription.auth_key
            }
        };
        
        const payload = JSON.stringify({
            title,
            body,
            url: url || '/',
            urgent: urgent || false,
            orderId: orderId || null,
            type: 'order-notification',
            timestamp: new Date().toISOString()
        });
        
        await webpush.sendNotification(pushSubscription, payload);
        console.log(`✅ Notification sent to user ${userId}: ${title}`);
        res.json({ success: true, message: 'Notification sent' });
        
    } catch (pushError) {
        console.error('Error sending push notification:', pushError);
        
        // If subscription is invalid (410 Gone) or VAPID mismatch (403), remove it
        if (pushError.statusCode === 410 || pushError.statusCode === 403) {
            await db.query('DELETE FROM notf WHERE user_id = ?', [userId]);
            console.log(`🔄 Removed invalid subscription for user ${userId} (status: ${pushError.statusCode})`);
        }
        
        res.status(500).json({ error: 'Failed to send notification' });
    }
}

/**
 * Send notification to all users in a hotel
 */
async function sendToHotel(req, res) {
    const { hotelCode, title, body, url, urgent, orderId, excludeUserId } = req.body;
    
    if (!hotelCode || !title || !body) {
        return res.status(400).json({ error: 'hotelCode, title, and body required' });
    }
    
    try {
        // Get all subscriptions for the hotel
        let query = 'SELECT * FROM notf WHERE hotel_code = ?';
        let params = [hotelCode];
        
        if (excludeUserId) {
            query += ' AND user_id != ?';
            params.push(excludeUserId);
        }
        
        const subscriptions = await db.query(query, params);
        
        if (!subscriptions || subscriptions.length === 0) {
            return res.status(404).json({ error: 'No subscriptions found for hotel' });
        }
        
        const payload = JSON.stringify({
            title,
            body,
            url: url || '/',
            urgent: urgent || false,
            orderId: orderId || null,
            type: 'order-notification',
            timestamp: new Date().toISOString()
        });
        
        // Send to all subscriptions
        const sendPromises = subscriptions.map(sub => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh_key,
                    auth: sub.auth_key
                }
            };
            
            return webpush.sendNotification(pushSubscription, payload)
                .catch(err => {
                    console.error(`Failed to send to user ${sub.user_id}:`, err);
                    // Remove invalid subscriptions
                    if (err.statusCode === 410) {
                        db.query('DELETE FROM notf WHERE user_id = ?', [sub.user_id]);
                    }
                });
        });
        
        await Promise.allSettled(sendPromises);
        console.log(`✅ Notifications sent to ${subscriptions.length} users in hotel ${hotelCode}`);
        res.json({ 
            success: true, 
            message: `Notifications sent to ${subscriptions.length} users` 
        });
        
    } catch (error) {
        console.error('Error in send-to-hotel route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Send notification to supervisors/team leaders
 */
async function sendToSupervisors(req, res) {
    const { hotelCode, title, body, url, urgent, orderId } = req.body;
    
    if (!hotelCode || !title || !body) {
        return res.status(400).json({ error: 'hotelCode, title, and body required' });
    }
    
    try {
        // Get all subscriptions for the hotel (supervisors only)
        const subscriptions = await db.query(`
            SELECT * FROM notf
            WHERE hotel_code = ?
        `, [hotelCode]);
        
        if (!subscriptions || subscriptions.length === 0) {
            return res.status(404).json({ error: 'No supervisor subscriptions found' });
        }
        
        const payload = JSON.stringify({
            title,
            body,
            url: url || '/',
            urgent: urgent !== undefined ? urgent : true,
            orderId: orderId || null,
            type: 'supervisor-alert',
            requireInteraction: true,
            timestamp: new Date().toISOString()
        });
        
        // Send to all supervisor subscriptions
        const sendPromises = subscriptions.map(sub => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh_key,
                    auth: sub.auth_key
                }
            };
            
            return webpush.sendNotification(pushSubscription, payload)
                .catch(err => {
                    console.error(`Failed to send to supervisor ${sub.user_id}:`, err);
                    if (err.statusCode === 410) {
                        db.query('DELETE FROM notf WHERE user_id = ?', [sub.user_id]);
                    }
                });
        });
        
        await Promise.allSettled(sendPromises);
        console.log(`✅ Supervisor alerts sent to ${subscriptions.length} supervisors`);
        res.json({ 
            success: true, 
            message: `Supervisor alerts sent to ${subscriptions.length} supervisors` 
        });
        
    } catch (error) {
        console.error('Error in send-to-supervisors route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Test notification
 */
async function testNotification(req, res) {
    const userId = req.body.userId || req.user.id;
    
    try {
        const subscriptions = await db.query(`
            SELECT * FROM notf 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [userId]);
        
        const subscription = subscriptions.length > 0 ? subscriptions[0] : null;
        
        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found' });
        }
        
        const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh_key,
                auth: subscription.auth_key
            }
        };
        
        const payload = JSON.stringify({
            title: '🔔 Test Notification',
            body: 'This is a test notification from RoomAid!',
            url: '/',
            type: 'test'
        });
        
        await webpush.sendNotification(pushSubscription, payload);
        console.log(`✅ Test notification sent to user ${userId}`);
        res.json({ success: true, message: 'Test notification sent' });
        
    } catch (pushError) {
        console.error('Push error:', pushError);
        res.status(500).json({ error: 'Failed to send test notification' });
    }
}

module.exports = {
    getVapidPublicKey,
    subscribe,
    sendNotification,
    sendToHotel,
    sendToSupervisors,
    testNotification
};
