// Firebase Cloud Messaging Service Worker
// This file handles background notifications when the app is not in focus

importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAepw58g6neZKaAtjyR7ZhnBx1qXxxJQUw",
    authDomain: "roomaidnotf.firebaseapp.com",
    projectId: "roomaidnotf",
    storageBucket: "roomaidnotf.firebasestorage.app",
    messagingSenderId: "167389486268",
    appId: "1:167389486268:web:d706a23cf70865d05944b9",
    measurementId: "G-891G4LKGL2"
};

// Initialize Firebase in service worker
firebase.initializeApp(firebaseConfig);

// Get messaging instance
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('Background message received:', payload);

    const notificationTitle = payload.notification?.title || 'RoomAid Notification';
    const notificationOptions = {
        body: payload.notification?.body || 'New notification',
        icon: payload.notification?.icon || '/RoomAidTaskBoard.png',
        badge: '/RoomAidTaskBoard.png',
        tag: payload.data?.orderId || 'roomaid-notification',
        data: payload.data,
        requireInteraction: payload.data?.urgent === 'true',
        vibrate: payload.data?.urgent === 'true' ? [200, 100, 200] : [200],
        actions: [
            {
                action: 'view',
                title: 'View Order'
            },
            {
                action: 'close',
                title: 'Dismiss'
            }
        ]
    };

    // Show notification
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('Notification clicked:', event);
    
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        // Open or focus the app
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then((clientList) => {
                    // Check if app is already open
                    for (const client of clientList) {
                        if (client.url.includes('index.html') || client.url.endsWith('/')) {
                            return client.focus();
                        }
                    }
                    // Open new window if not already open
                    if (clients.openWindow) {
                        return clients.openWindow('/');
                    }
                })
        );
    }
});
