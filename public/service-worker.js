/**
 * Service Worker for RoomAid Push Notifications
 * Handles push notifications, background sync, and offline functionality
 */

// Install event - cache essential files
self.addEventListener('install', event => {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker activating...');
    self.clients.claim();
});

// Handle incoming push notifications
self.addEventListener('push', event => {
    console.log('Push notification received:', event);
    
    if (!event.data) {
        console.log('Push event but no data');
        return;
    }
    
    try {
        const data = event.data.json();
        console.log('Push notification data:', data);
        
        const options = {
            body: data.body || 'New notification',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `notification-${data.orderId || Date.now()}`,
            requireInteraction: data.level === 2 ? true : false, // Keep urgent notifications on screen
            actions: [
                {
                    action: 'view',
                    title: 'View Order'
                },
                {
                    action: 'close',
                    title: 'Dismiss'
                }
            ],
            data: data
        };
        
        // Color code by notification level
        if (data.level === 2) {
            options.badge = '/favicon.ico';
            options.tag = `urgent-${data.orderId}`;
        }
        
        event.waitUntil(
            self.registration.showNotification(data.title || 'RoomAid Order', options)
        );
    } catch (error) {
        console.error('Error processing push notification:', error);
        
        // Fallback for non-JSON messages
        const title = event.data.text ? 'RoomAid Order' : 'New Notification';
        const body = event.data.text ? event.data.text() : 'You have a new order';
        
        event.waitUntil(
            self.registration.showNotification(title, {
                body: body,
                icon: '/favicon.ico',
                badge: '/favicon.ico'
            })
        );
    }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    console.log('Notification clicked:', event.notification.data);
    
    event.notification.close();
    
    const data = event.notification.data;
    
    if (event.action === 'close') {
        return;
    }
    
    // Open or focus the window
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Check if we have an open RoomAid window
            let matchingClient = null;
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('/') && !matchingClient) {
                    matchingClient = client;
                }
            }
            
            if (matchingClient) {
                // Focus existing window
                matchingClient.focus();
                // Send message to switch to correct department
                if (data.department) {
                    matchingClient.postMessage({
                        type: 'SWITCH_DEPARTMENT',
                        department: data.department
                    });
                }
            } else {
                // Open new window if none exists
                return clients.openWindow('/');
            }
        })
    );
});

// Handle notification close (for tracking)
self.addEventListener('notificationclose', event => {
    console.log('Notification closed:', event.notification.data);
});
