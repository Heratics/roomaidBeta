/**
 * Firebase Cloud Messaging Routes
 * Handles FCM token subscriptions and sending notifications
 */

const db = require('../database');
const auth = require('../auth');

// Firebase Admin SDK configuration
// Initialize only if Firebase credentials are available
let admin = null;
let fcmInitialized = false;

try {
    // Check if firebase-admin is installed
    admin = require('firebase-admin');
    
    // Initialize Firebase Admin with service account
    // You can use environment variables or a service account JSON file
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : null;

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: 'roomaidnotf'
        });
        fcmInitialized = true;
        console.log('✅ Firebase Admin SDK initialized successfully');
    } else {
        console.warn('⚠️  Firebase service account not configured. Using alternative method.');
    }
} catch (error) {
    console.warn('⚠️  Firebase Admin SDK not available. Install with: npm install firebase-admin');
    console.warn('    For now, FCM tokens will be stored but notifications may not be sent.');
}

/**
 * Create routes for FCM
 */
function createFCMRoutes(app) {
    /**
     * POST /api/fcm/subscribe
     * Save FCM token for a user
     */
    app.post('/api/fcm/subscribe', auth.authenticateToken, async (req, res) => {
        try {
            const { fcmToken, userId, username, deviceInfo } = req.body;

            if (!fcmToken) {
                return res.status(400).json({ error: 'FCM token is required' });
            }

            // Check if token already exists
            const existing = await db.query(
                'SELECT id FROM fcm_tokens WHERE fcm_token = ?',
                [fcmToken]
            );

            if (existing && existing.length > 0) {
                // Update existing token
                await db.query(
                    'UPDATE fcm_tokens SET user_id = ?, username = ?, device_info = ?, updated_at = NOW() WHERE fcm_token = ?',
                    [userId, username, JSON.stringify(deviceInfo || {}), fcmToken]
                );
            } else {
                // Insert new token
                await db.query(
                    'INSERT INTO fcm_tokens (user_id, username, fcm_token, device_info, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
                    [userId, username, fcmToken, JSON.stringify(deviceInfo || {})]
                );
            }

            res.json({ 
                success: true, 
                message: 'FCM token saved successfully',
                fcmEnabled: fcmInitialized
            });
        } catch (error) {
            console.error('Error saving FCM token:', error);
            res.status(500).json({ error: 'Failed to save FCM token' });
        }
    });

    /**
     * POST /api/fcm/send
     * Send notification via FCM
     */
    app.post('/api/fcm/send', auth.authenticateToken, async (req, res) => {
        try {
            const { userIds, title, body, data } = req.body;

            if (!userIds || userIds.length === 0) {
                return res.status(400).json({ error: 'User IDs are required' });
            }

            // Get FCM tokens for the specified users
            const tokens = await db.query(
                `SELECT fcm_token FROM fcm_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
                userIds
            );

            if (!tokens || tokens.length === 0) {
                return res.json({ 
                    success: true, 
                    message: 'No FCM tokens found for users',
                    sent: 0
                });
            }

            const fcmTokens = tokens.map(t => t.fcm_token);
            let sentCount = 0;

            // Send via Firebase Admin SDK if available
            if (fcmInitialized && admin) {
                const message = {
                    notification: {
                        title: title || 'RoomAid Notification',
                        body: body || 'You have a new notification'
                    },
                    data: data || {},
                    tokens: fcmTokens
                };

                const response = await admin.messaging().sendEachForMulticast(message);
                sentCount = response.successCount;

                // Remove invalid tokens
                if (response.failureCount > 0) {
                    const invalidTokens = [];
                    response.responses.forEach((resp, idx) => {
                        if (!resp.success) {
                            invalidTokens.push(fcmTokens[idx]);
                        }
                    });

                    if (invalidTokens.length > 0) {
                        await db.query(
                            `DELETE FROM fcm_tokens WHERE fcm_token IN (${invalidTokens.map(() => '?').join(',')})`,
                            invalidTokens
                        );
                        console.log(`🔄 Removed ${invalidTokens.length} invalid FCM tokens`);
                    }
                }

                res.json({ 
                    success: true, 
                    sent: sentCount,
                    failed: response.failureCount
                });
            } else {
                // Alternative: Use HTTP API directly (requires server key)
                const serverKey = process.env.FCM_SERVER_KEY;
                if (!serverKey) {
                    return res.status(503).json({ 
                        error: 'FCM not configured. Set FIREBASE_SERVICE_ACCOUNT or FCM_SERVER_KEY in environment.' 
                    });
                }

                const fetch = require('node-fetch');
                const promises = fcmTokens.map(token => 
                    fetch('https://fcm.googleapis.com/fcm/send', {
                        method: 'POST',
                        headers: {
                            'Authorization': `key=${serverKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            to: token,
                            notification: {
                                title: title || 'RoomAid Notification',
                                body: body || 'You have a new notification'
                            },
                            data: data || {}
                        })
                    })
                );

                const results = await Promise.allSettled(promises);
                sentCount = results.filter(r => r.status === 'fulfilled').length;

                res.json({ 
                    success: true, 
                    sent: sentCount,
                    failed: results.filter(r => r.status === 'rejected').length
                });
            }
        } catch (error) {
            console.error('Error sending FCM notification:', error);
            res.status(500).json({ error: 'Failed to send FCM notification' });
        }
    });

    /**
     * DELETE /api/fcm/unsubscribe
     * Remove FCM token
     */
    app.delete('/api/fcm/unsubscribe', auth.authenticateToken, async (req, res) => {
        try {
            const { fcmToken } = req.body;

            if (!fcmToken) {
                return res.status(400).json({ error: 'FCM token is required' });
            }

            await db.query('DELETE FROM fcm_tokens WHERE fcm_token = ?', [fcmToken]);

            res.json({ success: true, message: 'FCM token removed' });
        } catch (error) {
            console.error('Error removing FCM token:', error);
            res.status(500).json({ error: 'Failed to remove FCM token' });
        }
    });
}

/**
 * Helper function to send FCM notification
 */
async function sendFCMNotification(userIds, notification) {
    try {
        // Get FCM tokens for users
        const tokens = await db.query(
            `SELECT fcm_token FROM fcm_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
            userIds
        );

        if (!tokens || tokens.length === 0) {
            return { success: true, sent: 0 };
        }

        const fcmTokens = tokens.map(t => t.fcm_token);

        if (fcmInitialized && admin) {
            const message = {
                notification: {
                    title: notification.title || 'RoomAid',
                    body: notification.body || 'New notification'
                },
                data: notification.data || {},
                tokens: fcmTokens
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            
            // Clean up invalid tokens
            if (response.failureCount > 0) {
                const invalidTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        invalidTokens.push(fcmTokens[idx]);
                    }
                });

                if (invalidTokens.length > 0) {
                    await db.query(
                        `DELETE FROM fcm_tokens WHERE fcm_token IN (${invalidTokens.map(() => '?').join(',')})`,
                        invalidTokens
                    );
                }
            }

            return { 
                success: true, 
                sent: response.successCount,
                failed: response.failureCount 
            };
        }

        return { success: false, error: 'FCM not initialized' };
    } catch (error) {
        console.error('Error sending FCM notification:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    createFCMRoutes,
    sendFCMNotification,
    fcmInitialized
};
