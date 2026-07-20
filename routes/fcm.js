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

function buildMessageData(title, body, data) {
    const messageData = {
        title: String(title || 'RoomAid Notification'),
        body: String(body || 'You have a new notification')
    };

    if (data) {
        Object.keys(data).forEach(key => {
            messageData[key] = String(data[key]);
        });
    }

    return messageData;
}

// Helper: load service account from env and fix private_key newlines
function loadServiceAccountFromEnv() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        // Render often stores private_key with escaped newlines ("\\n"); convert to real newlines
        if (obj.private_key && obj.private_key.includes('\\n')) {
            obj.private_key = obj.private_key.replace(/\\n/g, '\n');
        }
        return obj;
    } catch (e) {
        console.warn('⚠️  Invalid FIREBASE_SERVICE_ACCOUNT JSON. Check env formatting.');
        return null;
    }
}

try {
    // Check if firebase-admin is installed
    admin = require('firebase-admin');
    
    // Initialize Firebase Admin with service account loaded from env
    const serviceAccount = loadServiceAccountFromEnv();

    if (serviceAccount) {
        const projectId = serviceAccount.project_id || process.env.FCM_PROJECT_ID || 'roomaidnotf';
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId
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
    // Middleware: authenticate via JWT (fallback if auth.authenticateToken is missing)
    const authenticateToken = auth.authenticateToken || ((req, res, next) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'Access token required' });
            }
            const user = auth.verifyToken(token);
            if (!user) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            req.user = user;
            next();
        } catch (e) {
            return res.status(401).json({ error: 'Authentication failed' });
        }
    });
    /**
     * POST /api/fcm/subscribe
     * Save FCM token for a user
     */
    app.post('/api/fcm/subscribe', authenticateToken, async (req, res) => {
        try {
            const { fcmToken, userId, username, deviceInfo } = req.body;

            if (!fcmToken) {
                return res.status(400).json({ error: 'FCM token is required' });
            }

            // Delete any existing token for this device (prevents old user from getting notifications)
            await db.query('DELETE FROM fcm_tokens WHERE fcm_token = ?', [fcmToken]);

            // Insert new token for current user
            await db.query(
                'INSERT INTO fcm_tokens (user_id, username, fcm_token, device_info, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
                [userId, username, fcmToken, JSON.stringify(deviceInfo || {})]
            );

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
    app.post('/api/fcm/send', authenticateToken, async (req, res) => {
        try {
            const { userIds, title, body, data } = req.body;

            if (!Array.isArray(userIds) || userIds.length === 0) {
                return res.status(400).json({ error: 'User IDs are required' });
            }

            const normalizedUserIds = userIds
                .map(id => Number(id))
                .filter(id => Number.isInteger(id) && id > 0);

            if (normalizedUserIds.length === 0) {
                return res.status(400).json({ error: 'User IDs must be positive integers' });
            }

            // Get FCM tokens for the specified users
            const tokens = await db.query(
                `SELECT fcm_token FROM fcm_tokens WHERE user_id IN (${normalizedUserIds.map(() => '?').join(',')})`,
                normalizedUserIds
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
                const messageData = buildMessageData(
                    title || 'RoomAid Notification',
                    body || 'You have a new notification',
                    data
                );
                
                const message = {
                    data: messageData,
                    webpush: {
                        headers: {
                            Urgency: messageData.urgent === 'true' ? 'high' : 'normal'
                        },
                        fcmOptions: {
                            link: messageData.url || '/'
                        }
                    },
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

                        // Load fetch compatibly (Node 18+ global or dynamic import of node-fetch v3)
                        const getFetch = async () => {
                            if (typeof fetch === 'function') return fetch;
                            const mod = await import('node-fetch');
                            return mod.default;
                        };

                        const fetchFn = await getFetch();
                        const promises = fcmTokens.map(token => 
                            fetchFn('https://fcm.googleapis.com/fcm/send', {
                                method: 'POST',
                                headers: {
                                    'Authorization': `key=${serverKey}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    to: token,
                                    data: buildMessageData(
                                        title || 'RoomAid Notification',
                                        body || 'You have a new notification',
                                        data
                                    )
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
    app.delete('/api/fcm/unsubscribe', authenticateToken, async (req, res) => {
        try {
            const { fcmToken } = req.body;
            const user = req.user;

            if (!fcmToken) {
                return res.status(400).json({ error: 'FCM token is required' });
            }

            // Delete by token AND user_id to ensure we remove the right token
            await db.query('DELETE FROM fcm_tokens WHERE fcm_token = ? OR user_id = ?', [fcmToken, user.id]);

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
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return { success: true, sent: 0 };
        }

        const normalizedUserIds = userIds
            .map(id => Number(id))
            .filter(id => Number.isInteger(id) && id > 0);

        if (normalizedUserIds.length === 0) {
            return { success: true, sent: 0 };
        }

        // Get FCM tokens for users
        const tokens = await db.query(
            `SELECT fcm_token FROM fcm_tokens WHERE user_id IN (${normalizedUserIds.map(() => '?').join(',')})`,
            normalizedUserIds
        );

        if (!tokens || tokens.length === 0) {
            return { success: true, sent: 0 };
        }

        const fcmTokens = tokens.map(t => t.fcm_token);

        if (fcmInitialized && admin) {
            const messageData = buildMessageData(
                notification.title || 'RoomAid',
                notification.body || 'New notification',
                notification.data
            );

            const message = {
                data: messageData,
                webpush: {
                    headers: {
                        Urgency: messageData.urgent === 'true' ? 'high' : 'normal'
                    },
                    fcmOptions: {
                        link: messageData.url || '/'
                    }
                },
                tokens: fcmTokens
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`📤 FCM notification sent: ${response.successCount} success, ${response.failureCount} failed`);

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
