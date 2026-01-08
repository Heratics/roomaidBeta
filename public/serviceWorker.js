self.addEventListener('install', function(event) {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    console.log('Service Worker activated');
    event.waitUntil(clients.claim());
});

// Handle push notifications
self.addEventListener('push', function(event) {
    console.log('Push notification received:', event);
    
    if (!event.data) {
        console.log('No data in push event');
        return;
    }
    
    const data = event.data.json();
    console.log('Push data:', data);
    
    const options = {
        body: data.body || 'You have a new notification',
        icon: '/icon-192.svg',
        badge: '/badge-72.svg',
        vibrate: [200, 100, 200, 100, 200],
        tag: data.tag || 'roomaid-notification',
        requireInteraction: data.requireInteraction || false,
        data: {
            url: data.url || '/',
            orderId: data.orderId,
            type: data.type
        },
        actions: data.actions || []
    };
    
    // Add urgency styling for overdue orders
    if (data.urgent) {
        options.requireInteraction = true;
        options.vibrate = [300, 100, 300, 100, 300];
    }
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'RoomAid', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
    console.log('Notification clicked:', event.notification.tag);
    event.notification.close();
    
    const notificationData = event.notification.data;
    const urlToOpen = notificationData.url || '/';
    
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(function(clientList) {
            // Check if there's already a window open
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // If no window is open, open a new one
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// Handle notification close
self.addEventListener('notificationclose', function(event) {
    console.log('Notification closed:', event.notification.tag);
});

