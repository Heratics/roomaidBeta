// Global state
let currentUser = null;
let currentToken = null;
let currentDepartment = 'Engineering';
let currentDateFilter = null;
let autoRefreshInterval = null;
let isLoadingOrders = false; // prevent overlapping fetches
let ordersInitialized = false;
let lastOrders = [];
const AUTO_REFRESH_INTERVAL = 30000; // Refresh
let notificationsInterval = null;
let seenNotificationIds = new Set();
let newOrdersPollingInterval = null;
let serviceWorkerReady = false;
let pushSubscription = null;

// DOM elements
const dashboardScreen = document.getElementById('dashboardScreen');
const addOrderBtn = document.getElementById('addOrderBtn');
const addOrderModal = document.getElementById('addOrderModal');
const addOrderForm = document.getElementById('addOrderForm');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelOrderBtn = document.getElementById('cancelOrderBtn');
const ordersList = document.getElementById('ordersList');
const hotelName = document.getElementById('hotelName');
const currentUserSpan = document.getElementById('currentUser');
const dateFilter = document.getElementById('dateFilter');
const clearDateFilter = document.getElementById('clearDateFilter');
const orderNotes = document.getElementById('orderNotes');
const currentLanguage = document.getElementById('currentLanguage');

// Toast state
let toastContainer = null;
let seenOrderIds = new Set();

// Settings menu state
let settingsMenuOpen = false;

// Delete confirmation modal elements
const deleteConfirmModal = document.getElementById('deleteConfirmModal');
const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Hold order modal elements
const holdOrderDayModal = document.getElementById('holdOrderDayModal');
const closeHoldDayModalBtn = document.getElementById('closeHoldDayModalBtn');
const holdSameDayBtn = document.getElementById('holdSameDayBtn');
const holdNextDayBtn = document.getElementById('holdNextDayBtn');
const holdReasonInput = document.getElementById('holdReasonInput'); // textarea element

const holdOrderTimeModal = document.getElementById('holdOrderTimeModal');
const closeHoldTimeModalBtn = document.getElementById('closeHoldTimeModalBtn');
const holdTimeFrameInput = document.getElementById('holdTimeFrameInput') || {};
const cancelHoldTimeBtn = document.getElementById('cancelHoldTimeBtn');
const confirmHoldTimeBtn = document.getElementById('confirmHoldTimeBtn');

const holdOrderNextDayTimeModal = document.getElementById('holdOrderNextDayTimeModal');
const closeHoldNextDayTimeModalBtn = document.getElementById('closeHoldNextDayTimeModalBtn');
const holdNextDayTimeInput = document.getElementById('holdNextDayTimeInput');
const cancelHoldNextDayTimeBtn = document.getElementById('cancelHoldNextDayTimeBtn');
const confirmHoldNextDayTimeBtn = document.getElementById('confirmHoldNextDayTimeBtn');

let orderToHold = null;
let holdOrderDay = null; // 'same-day' or 'next-day'
let holdNextDayTime = null; // time for next-day holds in HH:MM format

// Logs modal elements
const logsModal = document.getElementById('logsModal');
const closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
const logsMenuItem = document.getElementById('logsMenuItem');
const managerMenuItem = document.getElementById('managerMenuItem');

// Edit order modal elements
const editOrderModal = document.getElementById('editOrderModal');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const editOrderForm = document.getElementById('editOrderForm');
let orderToEdit = null;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    // Check if all required DOM elements exist
    if (!dashboardScreen || !addOrderBtn || !ordersList) {
        console.error('Required DOM elements not found. Dashboard may not function properly.');
    }
    
    // Initialize dark mode
    initializeDarkMode();
    autoDetectTheme();
    
    // Initialize language support
    initializeLanguage();

    // Prepare toast container
    initToastContainer();
    
    // Close settings menu when clicking outside
    document.addEventListener('click', function(event) {
        const settingsMenu = document.querySelector('.settings-menu');
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsDropdown = document.getElementById('settingsDropdown');
        
        if (settingsMenu && settingsBtn && settingsDropdown) {
            if (!settingsMenu.contains(event.target)) {
                settingsDropdown.classList.remove('active');
                settingsMenuOpen = false;
            }
        }
    });
    
    // Check if user has an active session
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');
    
    console.log('🔐 Session check:', { hasToken: !!savedToken, hasUser: !!savedUser });
    
    if (savedToken && savedUser) {
        try {
            currentToken = savedToken;
            currentUser = JSON.parse(savedUser);
            console.log('✅ Session restored for:', currentUser.username);
            const isPrivileged = currentUser && (currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'supervisor');
            if (logsMenuItem && isPrivileged) {
                logsMenuItem.style.display = 'flex';
            }
            if (managerMenuItem && isPrivileged) {
                managerMenuItem.style.display = 'flex';
            }
            
            // Initialize push notifications
            initializePushNotifications();
            
            showDashboard();
        } catch (error) {
            console.error('Error parsing saved user data:', error);
            // Clear corrupted session data
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            window.location.href = 'login.html';
            return;
        }
    } else {
        // User not logged in, redirect to login page
        console.log('❌ No active session found, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    setupEventListeners();
});

// Event listeners
function setupEventListeners() {
    // Add order
    addOrderBtn.addEventListener('click', showAddOrderModal);
    closeModalBtn.addEventListener('click', hideAddOrderModal);
    cancelOrderBtn.addEventListener('click', hideAddOrderModal);
    addOrderForm.addEventListener('submit', handleAddOrder);
    
    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDepartment = btn.dataset.department;
            updateActiveTab();
            loadOrders();
        });
    });
    
    // Date filter - initialize input to today but don't filter by default
    if (dateFilter) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayFormatted = `${year}-${month}-${day}`; // Correct YYYY-MM-DD format for input type="date"
        
        dateFilter.value = todayFormatted;
        // Don't set currentDateFilter by default - show all orders unless user filters
        currentDateFilter = null;
        
        dateFilter.addEventListener('change', handleDateFilter);
    }
    
    if (clearDateFilter) {
        clearDateFilter.addEventListener('click', clearDateFilterHandler);
    }
    
    // Delete confirmation modal
    if (closeDeleteModalBtn) {
        closeDeleteModalBtn.addEventListener('click', hideDeleteConfirmModal);
    }
    
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', hideDeleteConfirmModal);
    }
    
    // Logs modal
    if (closeLogsModalBtn) {
        closeLogsModalBtn.addEventListener('click', hideLogsModal);
    }
    
    // Logs date filter
    const logsDateFilter = document.getElementById('logsDateFilter');
    const clearLogsDateFilter = document.getElementById('clearLogsDateFilter');
    
    if (logsDateFilter) {
        logsDateFilter.addEventListener('change', () => {
            const activeTab = document.querySelector('[data-tab].active')?.dataset.tab || 'deleted';
            loadLogs(activeTab, logsDateFilter.value);
        });
    }
    
    if (clearLogsDateFilter) {
        clearLogsDateFilter.addEventListener('click', () => {
            logsDateFilter.value = '';
            const activeTab = document.querySelector('[data-tab].active')?.dataset.tab || 'deleted';
            loadLogs(activeTab, null);
        });
    }

    if (managerMenuItem) {
        managerMenuItem.addEventListener('click', openManagerDashboard);
    }
    
    // Hold order modals
    if (closeHoldDayModalBtn) {
        closeHoldDayModalBtn.addEventListener('click', hideHoldOrderDayModal);
    }
    
    if (holdSameDayBtn) {
        holdSameDayBtn.addEventListener('click', () => {
            const reasonValue = holdReasonInput ? holdReasonInput.value.trim() : '';
            console.log('Same Day clicked, holdReasonInput exists:', !!holdReasonInput, 'value:', reasonValue);
            
            if (!reasonValue) {
                alert('Please enter a reason for holding this order.');
                return;
            }
            holdOrderDay = 'same-day';
            hideHoldOrderDayModal();
            showHoldOrderTimeModal();
        });
    }
    
    if (holdNextDayBtn) {
        holdNextDayBtn.addEventListener('click', () => {
            const reasonValue = holdReasonInput ? holdReasonInput.value.trim() : '';
            console.log('Next Day clicked, holdReasonInput exists:', !!holdReasonInput, 'value:', reasonValue);
            
            if (!reasonValue) {
                alert('Please enter a reason for holding this order.');
                return;
            }
            holdOrderDay = 'next-day';
            hideHoldOrderDayModal();
            showHoldOrderNextDayTimeModal();
        });
    }
    
    if (closeHoldTimeModalBtn) {
        closeHoldTimeModalBtn.addEventListener('click', hideHoldOrderTimeModal);
    }
    
    if (cancelHoldTimeBtn) {
        cancelHoldTimeBtn.addEventListener('click', hideHoldOrderTimeModal);
    }
    
    if (confirmHoldTimeBtn) {
        confirmHoldTimeBtn.addEventListener('click', confirmHoldOrder);
    }
    
    // Next-day time modal event listeners
    if (closeHoldNextDayTimeModalBtn) {
        closeHoldNextDayTimeModalBtn.addEventListener('click', hideHoldOrderNextDayTimeModal);
    }
    
    if (cancelHoldNextDayTimeBtn) {
        cancelHoldNextDayTimeBtn.addEventListener('click', hideHoldOrderNextDayTimeModal);
    }
    
    if (confirmHoldNextDayTimeBtn) {
        confirmHoldNextDayTimeBtn.addEventListener('click', confirmHoldOrderNextDay);
    }
    
    // Quick time suggestions for hold order
    document.querySelectorAll('.quick-suggestion-btn[data-time]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const time = e.target.dataset.time;
            // Check if this is for the next-day time modal
            if (holdNextDayTimeInput && e.target.closest('#holdOrderNextDayTimeModal')) {
                holdNextDayTimeInput.value = time;
            } else if (holdTimeFrameInput && holdTimeFrameInput.value !== undefined) {
                holdTimeFrameInput.value = time;
            }
        });
    });
    
    // Edit order modal
    if (closeEditModalBtn) {
        closeEditModalBtn.addEventListener('click', hideEditOrderModal);
    }
    
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', hideEditOrderModal);
    }
    
    if (editOrderForm) {
        editOrderForm.addEventListener('submit', handleEditOrder);
    }
    
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', confirmDeleteOrder);
    }
    
    // Quick suggestion buttons using event delegation
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('quick-suggestion-btn')) {
            e.preventDefault();
            e.stopPropagation();
            
            const reason = e.target.dataset.reason;
            const time = e.target.dataset.time;
            
            console.log('Quick suggestion clicked:', { reason, time });
            
            if (reason) {
                // This is a hold reason button
                if (holdReasonInput) {
                    holdReasonInput.value = reason;
                    console.log('Hold reason set to:', reason);
                }
            } else if (time) {
                // This is a time frame button
                if (holdTimeFrameInput && holdTimeFrameInput.value !== undefined) {
                    holdTimeFrameInput.value = time;
                    console.log('Time frame set to:', time);
                }
            } else {
                // This is a deletion reason button (no data-reason attribute on deletion)
                if (deletionReasonInput && e.target.closest('.delete-confirm-modal')) {
                    const text = e.target.textContent.trim();
                    deletionReasonInput.value = text;
                    console.log('Deletion reason set to:', text);
                }
            }
        }
    });
    
    // Dark mode toggle
    
    // Language toggle is now in settings menu
    
    // Close burger menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.order-menu-container')) {
            document.querySelectorAll('.order-menu-dropdown.show').forEach(dropdown => {
                dropdown.classList.remove('show');
            });
        }
    });
}

// ============================================================================
// HOLD ORDER FUNCTIONS
// ============================================================================

// Show hold order day selection modal
function showHoldOrderDayModal(orderId) {
    orderToHold = orderId;
    holdOrderDayModal.style.display = 'flex';
}

// Hide hold order day selection modal
function hideHoldOrderDayModal() {
    holdOrderDayModal.style.display = 'none';
    // Don't clear holdReasonInput here - it's still needed for the actual hold confirmation!
    // It will be cleared in hideHoldOrderTimeModal after the hold is complete
    // Don't clear holdOrderDay here - it's still needed!
    // It will be cleared in hideHoldOrderTimeModal after completing the hold
}

// Show hold order time frame modal
function showHoldOrderTimeModal() {
    holdOrderTimeModal.style.display = 'flex';
}

// Hide hold order time frame modal
function hideHoldOrderTimeModal() {
    holdOrderTimeModal.style.display = 'none';
    if (holdTimeFrameInput && holdTimeFrameInput.value !== undefined) {
        holdTimeFrameInput.value = '';
    }
    if (holdReasonInput && holdReasonInput.value !== undefined) {
        holdReasonInput.value = ''; // Clear reason after hold completes
    }
    holdOrderDay = null; // Clear here after the flow is complete
}

// Show hold order next-day time modal
function showHoldOrderNextDayTimeModal() {
    if (holdNextDayTimeInput) {
        holdNextDayTimeInput.value = '08:00'; // Default to 8:00 AM
    }
    holdOrderNextDayTimeModal.style.display = 'flex';
}

// Hide hold order next-day time modal
function hideHoldOrderNextDayTimeModal() {
    holdOrderNextDayTimeModal.style.display = 'none';
    if (holdNextDayTimeInput) {
        holdNextDayTimeInput.value = '';
    }
    holdNextDayTime = null;
    holdOrderDay = null;
}

// Confirm hold order for next day
async function confirmHoldOrderNextDay() {
    const timeValue = holdNextDayTimeInput ? holdNextDayTimeInput.value : '';
    console.log('confirmHoldOrderNextDay called with:', { orderToHold, time: timeValue, reason: holdReasonInput ? holdReasonInput.value : 'N/A' });
    
    if (!orderToHold) {
        alert('No order selected. Please try again.');
        return;
    }
    
    if (!timeValue) {
        alert('Please select a time for the next day hold.');
        return;
    }
    
    const holdReason = holdReasonInput ? holdReasonInput.value.trim() : '';
    if (!holdReason) {
        alert('Please enter a reason for holding this order.');
        return;
    }
    
    holdNextDayTime = timeValue;
    
    const holdData = {
        day: 'next-day',
        timeFrame: null,
        reason: holdReason,
        nextDayTime: timeValue
    };
    
    console.log('Hold data to send:', holdData);
    
    try {
        const response = await fetch(`/api/orders/${orderToHold}/hold`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(holdData)
        });
        
        console.log('Hold response status:', response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('Order held successfully:', result);
            hideHoldOrderNextDayTimeModal();
            // Clear the held order
            orderToHold = null;
            // Small delay to ensure server has processed the hold
            setTimeout(() => {
                loadOrders(); // Reload orders to show updated status
            }, 500);
        } else {
            const errorData = await response.json();
            console.error('Failed to hold order:', errorData);
            alert(`Failed to hold order: ${errorData.error || 'Please try again.'}`);
        }
    } catch (error) {
        console.error('Error holding order:', error);
        alert('Error holding order. Please try again.');
    }
}

// Confirm hold order
async function confirmHoldOrder() {
    console.log('confirmHoldOrder called with:', { orderToHold, holdOrderDay, timeFrame: holdTimeFrameInput.value, reason: holdReasonInput ? holdReasonInput.value : 'N/A' });
    
    if (!orderToHold) {
        console.error('No order to hold');
        alert('No order selected. Please try again.');
        return;
    }
    
    if (!holdOrderDay) {
        console.error('No hold day selected');
        alert('Please select same day or next day.');
        return;
    }
    
    const holdReason = holdReasonInput ? holdReasonInput.value.trim() : '';
    console.log('Hold reason check - holdReasonInput exists:', !!holdReasonInput, 'value:', holdReason, 'length:', holdReason.length);
    
    if (!holdReason) {
        console.error('Hold reason is empty or undefined');
        alert('Please enter a reason for holding this order.');
        return;
    }
    
    const holdData = {
        day: holdOrderDay,
        timeFrame: holdOrderDay === 'same-day' ? (holdTimeFrameInput.value || null) : null,
        reason: holdReason
    };
    
    console.log('Hold data to send:', holdData);
    
    // Validate time frame for same-day holds
    if (holdOrderDay === 'same-day' && !holdData.timeFrame) {
        alert('Please enter a time frame for the hold.');
        return;
    }
    
    try {
        const response = await fetch(`/api/orders/${orderToHold}/hold`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(holdData)
        });
        
        console.log('Hold response status:', response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('Order held successfully:', result);
            hideHoldOrderDayModal();
            hideHoldOrderTimeModal();
            // Clear the held order
            orderToHold = null;
            // Small delay to ensure server has processed the hold
            setTimeout(() => {
                loadOrders(); // Reload orders to show updated status
            }, 500);
        } else {
            const errorData = await response.json();
            console.error('Failed to hold order:', errorData);
            alert(`Failed to hold order: ${errorData.error || 'Please try again.'}`);
        }
    } catch (error) {
        console.error('Error holding order:', error);
        alert('Error holding order. Please try again.');
    }
}



// Logout handler
async function handleLogout() {
    // Stop auto-refresh
    stopAutoRefresh();
    
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    // Clear state and session
    currentToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    
    // Redirect to login page
    window.location.href = 'login.html';
}

// Show dashboard
function showDashboard() {
    console.log('Showing dashboard...');
    
    if (dashboardScreen) {
        dashboardScreen.style.display = 'block';
        console.log('Dashboard screen displayed');
    } else {
        console.error('Dashboard screen element not found');
    }
    
    // Update UI
    if (hotelName) {
        hotelName.textContent = currentUser.hotelName || 'RoomAid Dashboard';
        console.log('Hotel name updated');
    }
    
    if (currentUserSpan) {
        currentUserSpan.textContent = `Welcome, ${currentUser.name || currentUser.username}`;
        console.log('User span updated');
    }
    
    // Load orders
    console.log('Loading orders...');
    loadOrders();
    
    // Start auto-refresh
    startAutoRefresh();
    
    // Start notifications polling
    startNotificationsPolling();
}

// Load orders for current department
async function loadOrders() {
    if (isLoadingOrders) {
        console.log('loadOrders skipped: already in progress');
        return;
    }
    isLoadingOrders = true;
    try {
        console.log('Loading orders for department:', currentDepartment, 'date filter:', currentDateFilter);
        console.log('Current token:', currentToken ? 'Present' : 'Missing');
        
        let url = `/api/orders?department=${currentDepartment}`;
        if (currentDateFilter) {
            url += `&date=${currentDateFilter}`;
        }
        
        console.log('Fetching from URL:', url);
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        console.log('Response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('Orders received:', data.orders);
            if (!ordersInitialized) {
                data.orders.forEach(o => seenOrderIds.add(o.id));
                ordersInitialized = true;
            } else {
                handleNewOrders(data.orders, currentDepartment);
            }
            lastOrders = data.orders || [];
            displayOrders(lastOrders);
        } else {
            console.error('Failed to load orders, status:', response.status);
            // Keep existing orders to avoid flicker when a single fetch fails
            displayOrders(lastOrders);
        }
    } catch (error) {
        console.error('Error loading orders:', error);
        displayOrders(lastOrders);
    } finally {
        isLoadingOrders = false;
    }
}

// Start auto-refresh for orders
function startAutoRefresh() {
    // Clear any existing interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Set up auto-refresh interval
    autoRefreshInterval = setInterval(() => {
        // Only refresh if user is logged in and on dashboard
        if (currentToken && dashboardScreen && dashboardScreen.style.display !== 'none') {
            loadOrders();
        }
    }, AUTO_REFRESH_INTERVAL);
    
    console.log('Auto-refresh started (every', AUTO_REFRESH_INTERVAL / 1000, 'seconds)');
}

// Stop auto-refresh
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto-refresh stopped');
    }
    
    if (notificationsInterval) {
        clearInterval(notificationsInterval);
        notificationsInterval = null;
        console.log('Notifications polling stopped');
    }
}

// Start polling for pending order notifications
function startNotificationsPolling() {
    if (notificationsInterval) clearInterval(notificationsInterval);
    if (newOrdersPollingInterval) clearInterval(newOrdersPollingInterval);

    // Poll every 10 seconds for newly created orders
    newOrdersPollingInterval = setInterval(() => {
        if (currentToken && dashboardScreen && dashboardScreen.style.display !== 'none') {
            checkNewOrderNotifications();
        }
    }, 10000);

    // Poll every 30 seconds for pending/overdue notifications
    notificationsInterval = setInterval(() => {
        if (currentToken && dashboardScreen && dashboardScreen.style.display !== 'none') {
            checkPendingNotifications();
        }
    }, 30000);

    // Also check immediately
    checkNewOrderNotifications();
    checkPendingNotifications();
    console.log('Notifications polling started');
}

// Check for newly created orders
async function checkNewOrderNotifications() {
    try {
        const response = await fetch('/api/notifications/new-orders', {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.notifications && Array.isArray(data.notifications)) {
                data.notifications.forEach(notif => {
                    if (!seenNotificationIds.has(`${notif.id}-new`)) {
                        seenNotificationIds.add(`${notif.id}-new`);
                        showNewOrderNotification(notif);
                        sendPushNotificationToDevice(notif);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error checking new order notifications:', error);
    }
}

// Show notification for newly created order
function showNewOrderNotification(notification) {
    if (!toastContainer) initToastContainer();

    const roomMatch = (notification.order_name || '').match(/Room\s+(.*)/i);
    const roomText = roomMatch ? roomMatch[1] : (notification.order_name || '');

    const toast = document.createElement('div');
    toast.className = 'new-order-toast';
    toast.style.minWidth = '280px';
    toast.style.maxWidth = '360px';
    toast.style.background = '#10b981'; // Green for new orders
    toast.style.color = '#fff';
    toast.style.border = 'none';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
    toast.style.padding = '12px 14px';
    toast.style.position = 'relative';
    toast.style.overflow = 'hidden';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '6px';
    closeBtn.style.right = '8px';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#fff';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '14px';
    closeBtn.addEventListener('click', () => {
        toast.remove();
    });

    const title = document.createElement('div');
    title.textContent = '🆕 New Order Received!';
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    title.style.fontSize = '14px';

    const body = document.createElement('div');
    body.textContent = `${notification.department}: Room ${roomText}`;
    body.style.fontSize = '13px';
    body.style.marginBottom = '4px';
    body.style.opacity = '0.95';

    const creator = document.createElement('div');
    creator.textContent = `By: ${notification.creatorName}`;
    creator.style.fontSize = '12px';
    creator.style.opacity = '0.85';

    toast.appendChild(closeBtn);
    toast.appendChild(title);
    toast.appendChild(body);
    toast.appendChild(creator);
    toastContainer.appendChild(toast);

    // Auto-dismiss after 6 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 6000);
}

// Check for pending notifications (unclaimed orders)
async function checkPendingNotifications() {
    try {
        const response = await fetch('/api/notifications/pending', {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.notifications && Array.isArray(data.notifications)) {
                data.notifications.forEach(notif => {
                    if (!seenNotificationIds.has(`${notif.id}-${notif.level}`)) {
                        seenNotificationIds.add(`${notif.id}-${notif.level}`);
                        showPendingOrderNotification(notif);
                        sendPushNotificationToDevice(notif);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error checking pending notifications:', error);
    }
}

// Show notification for unclaimed order
function showPendingOrderNotification(notification) {
    if (!toastContainer) initToastContainer();
    
    const roomMatch = (notification.order_name || '').match(/Room\s+(.*)/i);
    const roomText = roomMatch ? roomMatch[1] : (notification.order_name || '');
    
    const toast = document.createElement('div');
    toast.className = 'pending-order-toast';
    toast.style.minWidth = '280px';
    toast.style.maxWidth = '360px';
    
    // Determine background color based on notification level
    const levelColors = {
        1: '#f59e0b', // Yellow for 3 mins
        2: '#ff8c00', // Orange for 5 mins
        3: '#dc2626', // Red for 8 mins
        4: '#7f1d1d'  // Dark red for 10+ mins
    };
    
    toast.style.background = levelColors[notification.level] || '#f57c00';
    toast.style.color = '#fff';
    toast.style.border = 'none';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = notification.level === 4 
        ? '0 6px 20px rgba(127, 29, 29, 0.4)' 
        : '0 6px 20px rgba(0,0,0,0.3)';
    toast.style.padding = '12px 14px';
    toast.style.position = 'relative';
    toast.style.overflow = 'hidden';
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '6px';
    closeBtn.style.right = '8px';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#fff';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '14px';
    closeBtn.addEventListener('click', () => {
        toast.remove();
    });
    
    const title = document.createElement('div');
    const levelTitles = {
        1: '⏰ Pending Order (3 mins)',
        2: '⏰ Pending Order (5 mins)',
        3: '⚠️ Unclaimed Order (8 mins)',
        4: '🚨 URGENT: Unclaimed Order (10 mins)'
    };
    title.textContent = levelTitles[notification.level] || '⏰ Pending Order';
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    title.style.fontSize = '14px';
    
    const body = document.createElement('div');
    body.textContent = `${notification.department}: Room ${roomText}`;
    body.style.fontSize = '13px';
    body.style.marginBottom = '4px';
    body.style.opacity = '0.95';
    
    const creator = document.createElement('div');
    creator.textContent = `By: ${notification.creatorName}`;
    creator.style.fontSize = '12px';
    creator.style.opacity = '0.85';
    
    toast.appendChild(closeBtn);
    toast.appendChild(title);
    toast.appendChild(body);
    toast.appendChild(creator);
    toastContainer.appendChild(toast);
    
    // Auto-dismiss timing: longer for more urgent levels
    const durations = {
        1: 6000,  // 6 seconds for 3 mins
        2: 7000,  // 7 seconds for 5 mins
        3: 8000,  // 8 seconds for 8 mins
        4: 10000  // 10 seconds for 10+ mins
    };
    const duration = durations[notification.level] || 6000;
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, duration);
}

// ============================================================================
// PUSH NOTIFICATIONS
// ============================================================================

/**
 * Initialize push notifications
 * Register service worker and request notification permissions
 */
async function initializePushNotifications() {
    try {
        // Check if browser supports service workers and push notifications
        if (!('serviceWorker' in navigator)) {
            console.log('Service Workers not supported');
            return;
        }

        if (!('Notification' in window)) {
            console.log('Push Notifications not supported');
            return;
        }

        // Request notification permission if not already granted
        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        // Register service worker
        const registration = await navigator.serviceWorker.register('/service-worker.js', {
            scope: '/'
        });

        console.log('✅ Service Worker registered successfully');
        serviceWorkerReady = true;

        // Subscribe to push notifications if permission is granted
        if (Notification.permission === 'granted') {
            await subscribeToPushNotifications(registration);
        }

        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    } catch (error) {
        console.warn('Push notifications initialization failed:', error);
        // This is not critical - app can still work without push notifications
    }
}

/**
 * Fetch VAPID public key from server
 */
async function fetchVapidPublicKey() {
    try {
        const response = await fetch('/api/push/public-key');
        if (!response.ok) {
            console.warn('No VAPID public key configured on server');
            return null;
        }
        const data = await response.json();
        return data.publicKey || null;
    } catch (error) {
        console.warn('Failed to fetch VAPID public key:', error);
        return null;
    }
}

/**
 * Subscribe device to push notifications
 */
async function subscribeToPushNotifications(registration) {
    try {
        const publicKey = await fetchVapidPublicKey();
        if (!publicKey) {
            console.warn('Skipping push subscription: missing VAPID public key');
            return;
        }

        // Get existing subscription or create new one
        let subscription = await registration.pushManager.getSubscription();

        // If an old subscription exists with a different VAPID key, resubscribe
        if (subscription && subscription.options?.applicationServerKey) {
            const existingKey = btoa(String.fromCharCode(...new Uint8Array(subscription.options.applicationServerKey)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            if (existingKey !== publicKey) {
                await subscription.unsubscribe();
                subscription = null;
            }
        }

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        // Save subscription to server
        await saveSubscriptionToServer(subscription);
        pushSubscription = subscription;
        console.log('✅ Push subscription successful');
    } catch (error) {
        console.error('Failed to subscribe to push notifications:', error);
    }
}

/**
 * Convert VAPID key from base64 to Uint8Array
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Save push subscription to server
 */
async function saveSubscriptionToServer(subscription) {
    try {
        const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                userId: currentUser.id,
                username: currentUser.username
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        console.log('✅ Subscription saved to server');
    } catch (error) {
        console.error('Failed to save subscription to server:', error);
    }
}

/**
 * Handle messages from service worker
 */
function handleServiceWorkerMessage(event) {
    console.log('Message from service worker:', event.data);

    if (event.data && event.data.type === 'SWITCH_DEPARTMENT') {
        // Switch to the department in the notification
        currentDepartment = event.data.department;
        updateActiveTab();
        loadOrders();
    }
}

/**
 * Send web push notification to device
 * Uses service worker to display notification even when tab is closed
 */
function sendPushNotificationToDevice(notification) {
    try {
        if (!serviceWorkerReady || !navigator.serviceWorker.controller) {
            console.log('Service worker not ready for push notifications');
            return;
        }

        const roomMatch = (notification.order_name || '').match(/Room\s+(.*)/i);
        const roomText = roomMatch ? roomMatch[1] : (notification.order_name || '');

        const levelTitles = {
            0: `🆕 New Order Received!`,
            1: `⏰ Pending Order (3 mins)`,
            2: `⏰ Pending Order (5 mins)`,
            3: `⚠️ Unclaimed Order (8 mins)`,
            4: `🚨 URGENT: Unclaimed Order (10 mins)`
        };

        const title = levelTitles[notification.level] || `🆕 New Order`;
        const message = `${notification.department}: Room ${roomText}`;

        // Check if service worker has push manager
        navigator.serviceWorker.ready.then(registration => {
            if (registration.pushManager) {
                // Get current subscription to verify we have push capability
                registration.pushManager.getSubscription().then(subscription => {
                    if (subscription) {
                        // In production, the server would send the actual push
                        // For now, we can show the notification via the service worker
                        console.log('✅ Push notification would be sent to device:', {
                            title: title,
                            message: message,
                            level: notification.level
                        });
                    }
                });
            }
        });
    } catch (error) {
        console.warn('Error sending push notification:', error);
    }
}

function handleNewOrders(orders, department) {
    if (!Array.isArray(orders) || orders.length === 0) return;
    const newOrders = orders.filter(o => !seenOrderIds.has(o.id));
    newOrders.forEach(o => seenOrderIds.add(o.id));

    newOrders.forEach(order => {
        if (currentUser && order.sent_by !== currentUser.id) {
            showOrderToast(order, department);
        }
    });
}

function initToastContainer() {
    if (toastContainer) return;
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.style.position = 'fixed';
    toastContainer.style.top = '20px';
    toastContainer.style.right = '20px';
    toastContainer.style.display = 'flex';
    toastContainer.style.flexDirection = 'column';
    toastContainer.style.gap = '10px';
    toastContainer.style.zIndex = '9999';
    document.body.appendChild(toastContainer);
}

function showOrderToast(order, department) {
    if (!toastContainer) initToastContainer();

    const roomMatch = (order.order_name || '').match(/Room\s+(.*)/i);
    const roomText = roomMatch ? roomMatch[1] : (order.order_name || '');
    const toast = document.createElement('div');
    toast.className = 'order-toast';
    toast.style.minWidth = '240px';
    toast.style.maxWidth = '320px';
    toast.style.background = 'var(--bg-secondary)';
    toast.style.color = 'var(--text-primary)';
    toast.style.border = '1px solid var(--border-primary)';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 6px 14px var(--shadow-primary)';
    toast.style.padding = '12px 14px';
    toast.style.position = 'relative';
    toast.style.overflow = 'hidden';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '6px';
    closeBtn.style.right = '8px';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = 'var(--text-primary)';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '14px';
    closeBtn.addEventListener('click', () => {
        toast.remove();
    });

    const title = document.createElement('div');
    title.textContent = `${department} order`;
    title.style.fontWeight = '700';
    title.style.marginBottom = '4px';

    const body = document.createElement('div');
    body.textContent = `Room: ${roomText}`;
    body.style.fontSize = '14px';
    body.style.color = 'var(--text-secondary)';

    toast.appendChild(closeBtn);
    toast.appendChild(title);
    toast.appendChild(body);
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Display orders in the list
function displayOrders(orders) {
    ordersList.innerHTML = '';
    
    if (orders.length === 0) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <h3>No ${currentDepartment} orders</h3>
                <p>All tasks are completed or no new orders have been created.</p>
            </div>
        `;
        return;
    }
    
    orders.forEach(order => {
        const orderCard = createOrderCard(order);
        ordersList.appendChild(orderCard);
    });
    
    // Process all Arabic text in the displayed orders
    processAllArabicText();
}

// XSS protection function
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;'
    };
    return text.replace(/[&<>"'/]/g, (s) => map[s]);
}

// Create order card element
function createOrderCard(order) {
    const card = document.createElement('div');
    
    // Determine order status based on database fields
    const isCompleted = Boolean(order.completed_at);
    const isReceived = Boolean(order.assigned_to) && !isCompleted;
    const isPending = !Boolean(order.assigned_to) && !isCompleted;
    
    // Check if order is overdue (pending for more than 3 minutes)
    // Progressive urgency: 3 mins, 5 mins, 8 mins, 10 mins (urgent)
    let isOverdue = false;
    let overdueLevel = 0; // 0: not overdue, 1: 3 mins, 2: 5 mins, 3: 8 mins, 4: 10 mins (urgent)
    if (isPending && order.created_at) {
        const createdTime = new Date(order.created_at);
        const now = new Date();
        const diffMs = now - createdTime;
        const diffMinutes = Math.floor(diffMs / 60000);
        
        if (diffMinutes >= 3) {
            isOverdue = true;
            if (diffMinutes >= 10) {
                overdueLevel = 4; // Urgent
            } else if (diffMinutes >= 8) {
                overdueLevel = 3;
            } else if (diffMinutes >= 5) {
                overdueLevel = 2;
            } else {
                overdueLevel = 1;
            }
        }
    }
    
    // Add appropriate CSS classes for styling
    card.className = `order-card ${isCompleted ? 'completed' : isReceived ? 'received' : 'pending'}`;
    
    const createdAt = new Date(order.created_at).toLocaleString();
    const completedAt = order.completed_at ? new Date(order.completed_at).toLocaleString() : null;
    
    // Calculate time taken if completed (from creation to completion)
    let timeTaken = '';
    if (isCompleted && order.created_at && order.completed_at) {
        const createdTime = new Date(order.created_at);
        const completedTime = new Date(order.completed_at);
        const diffMs = completedTime - createdTime;
        
        const diffHours = Math.floor(diffMs / 3600000);
        const diffMins = Math.floor((diffMs % 3600000) / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        
        if (diffHours > 0) {
            timeTaken = `⏱️ Time taken: ${diffHours}h ${diffMins}m ${diffSecs}s`;
        } else if (diffMins > 0) {
            timeTaken = `⏱️ Time taken: ${diffMins}m ${diffSecs}s`;
        } else {
            timeTaken = `⏱️ Time taken: ${diffSecs}s`;
        }
    }
    
    // Extract room number from order_name (e.g., "Room 101" -> "101") and escape it
    const roomNumber = order.order_name ? escapeHtml(order.order_name.replace('Room ', '')) : 'N/A';
    
    // Show employee names instead of usernames and escape them
    const creatorName = escapeHtml(order.creatorName || order.creatorUsername || 'Unknown');
    const receiverName = escapeHtml(order.receiverName || order.receiverUsername || 'Unknown');
    
    // Escape order notes for XSS protection
    const orderNotes = order.order_notes ? escapeHtml(order.order_notes) : '';
    
    card.innerHTML = `
        <div class="order-header">
            <div class="order-title">
                Room ${roomNumber}
                ${isOverdue ? `<span class="overdue-badge overdue-level-${overdueLevel}">
                    ${overdueLevel === 4 ? '🚨 URGENT: 10+ mins' : overdueLevel === 3 ? '⚠️ 8 mins' : overdueLevel === 2 ? '⏰ 5 mins' : '⏰ 3 mins'}
                </span>` : ''}
            </div>
            <div class="order-actions">
                ${!isCompleted && !isReceived ? `<button class="btn btn-primary receive-btn" data-order-id="${escapeHtml(order.id)}">Receive</button>` : ''}
                ${isReceived && !isCompleted ? `<button class="btn btn-success complete-btn" data-order-id="${escapeHtml(order.id)}">Complete</button>` : ''}
                <div class="order-menu-container">
                    <button class="order-menu-btn" data-order-id="${escapeHtml(order.id)}" title="More Options">⋮</button>
                    <div class="order-menu-dropdown">
                        <button class="menu-item edit-btn" data-order-id="${escapeHtml(order.id)}">✏️ Edit</button>
                        <button class="menu-item hold-btn" data-order-id="${escapeHtml(order.id)}">⏸️ Hold</button>
                        <button class="menu-item delete-btn" data-order-id="${escapeHtml(order.id)}">🗑️ Delete</button>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="order-meta">
            <span>📅 ${escapeHtml(createdAt)}</span>
            <span>👤 ${creatorName}</span>
        </div>
        
        ${orderNotes ? `<div class="order-notes" data-notes="${escapeHtml(order.order_notes)}">${orderNotes}</div>` : ''}
        
        ${order.on_hold ? `
            <div class="order-hold">
                ⏸️ ${escapeHtml(order.hold_info || 'On Hold')}
                ${order.hold_until ? `<br><small>On hold until: ${new Date(order.hold_until).toLocaleString()}</small>` : ''}
            </div>
        ` : ''}
        
        ${isReceived && !order.on_hold ? `
            <div class="order-received">
                🔄 In Progress - Assigned to ${receiverName}
            </div>
        ` : ''}
        
        ${isCompleted ? `
            <div class="order-completion">
                ✅ Completed by ${receiverName} on ${escapeHtml(completedAt)}
                ${timeTaken ? `<br><small>${escapeHtml(timeTaken)}</small>` : ''}
            </div>
        ` : ''}
    `;
    
    // Add button event listeners
    const receiveBtn = card.querySelector('.receive-btn');
    if (receiveBtn) {
        receiveBtn.addEventListener('click', () => {
            receiveOrder(order.id);
        });
    }
    
    const completeBtn = card.querySelector('.complete-btn');
    if (completeBtn) {
        completeBtn.addEventListener('click', () => completeOrder(order.id));
    }
    
    // Burger menu functionality
    const menuBtn = card.querySelector('.order-menu-btn');
    const menuDropdown = card.querySelector('.order-menu-dropdown');
    
    if (menuBtn && menuDropdown) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close all other open menus
            document.querySelectorAll('.order-menu-dropdown.show').forEach(dropdown => {
                if (dropdown !== menuDropdown) {
                    dropdown.classList.remove('show');
                }
            });
            menuDropdown.classList.toggle('show');
        });
    }
    
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            showEditOrderModal(order);
            menuDropdown?.classList.remove('show');
        });
    }
    
    const holdBtn = card.querySelector('.hold-btn');
    if (holdBtn) {
        holdBtn.addEventListener('click', () => {
            showHoldOrderDayModal(order.id);
            menuDropdown?.classList.remove('show');
        });
    }
    
    const deleteBtn = card.querySelector('.delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            deleteOrder(order.id);
            menuDropdown?.classList.remove('show');
        });
    }
    
    // Process Arabic text in order notes
    const notesElement = card.querySelector('.order-notes');
    if (notesElement) {
        processArabicText(notesElement);
    }
    
    return card;
}

// Receive order
async function receiveOrder(orderId) {
    try {
        const response = await fetch(`/api/orders/${orderId}/receive`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            // Small delay to ensure server has processed the change
            setTimeout(() => {
                loadOrders(); // Reload orders to show updated status
            }, 500);
        } else {
            const errorData = await response.json();
            console.error('Failed to receive order:', errorData);
        }
    } catch (error) {
        console.error('Error receiving order:', error);
    }
}

// Complete order
async function completeOrder(orderId) {
    try {
        const response = await fetch(`/api/orders/${orderId}/complete`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            // Small delay to ensure server has processed the change
            setTimeout(() => {
                loadOrders(); // Reload orders to show updated status
            }, 500);
        } else {
            console.error('Failed to complete order');
        }
    } catch (error) {
        console.error('Error completing order:', error);
    }
}

// Global variable to store the order ID for deletion
let orderToDelete = null;

// Show delete confirmation modal
function showDeleteConfirmModal(orderId) {
    orderToDelete = orderId;
    deleteConfirmModal.style.display = 'flex';
}

// Hide delete confirmation modal
function hideDeleteConfirmModal() {
    deleteConfirmModal.style.display = 'none';
    orderToDelete = null;
    deletionReasonInput.value = '';
}

// Confirm delete order
async function confirmDeleteOrder() {
    if (!orderToDelete) {
        return;
    }
    
    try {
        const response = await fetch(`/api/orders/${orderToDelete}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                deletionReason: deletionReasonInput.value || 'No reason provided'
            })
        });
        
        if (response.ok) {
            hideDeleteConfirmModal();
            // Small delay to ensure server has processed the deletion
            setTimeout(() => {
                loadOrders(); // Reload orders to show updated list
            }, 500);
        } else {
            console.error('Failed to delete order');
        }
    } catch (error) {
        console.error('Error deleting order:', error);
    }
}

// Delete order (triggered by button click)
function deleteOrder(orderId) {
    showDeleteConfirmModal(orderId);
}

// Show add order modal
function showAddOrderModal() {
    if (addOrderModal) {
        addOrderModal.style.display = 'flex';
        
        // Add click handler to close modal when clicking outside
        addOrderModal.addEventListener('click', function(e) {
            if (e.target === addOrderModal) {
                hideAddOrderModal();
            }
        });
    }
    
    if (addOrderForm) {
        addOrderForm.reset();
    }
}

// Hide add order modal
function hideAddOrderModal() {
    addOrderModal.style.display = 'none';
}

// Input validation functions
function validateRoomNumber(roomNumber) {
    if (!roomNumber || typeof roomNumber !== 'string') {
        return { isValid: false, error: 'Room number is required' };
    }
    
    const sanitized = roomNumber.trim().replace(/[<>'";\\]/g, '');
    
    if (!/^[A-Za-z0-9\s-]{1,20}$/.test(sanitized)) {
        return { isValid: false, error: 'Invalid room number format' };
    }
    
    return { isValid: true, value: sanitized };
}

function validateNotes(notes) {
    if (!notes) {
        return { isValid: true, value: '' };
    }
    
    if (typeof notes !== 'string') {
        return { isValid: false, error: 'Notes must be text' };
    }
    
    const sanitized = notes.trim().replace(/[<>'";\\]/g, '');
    
    if (sanitized.length > 500) {
        return { isValid: false, error: 'Notes must be 500 characters or less' };
    }
    
    return { isValid: true, value: sanitized };
}

function validateDepartment(department) {
    if (!department || typeof department !== 'string') {
        return { isValid: false, error: 'Department is required' };
    }
    
    const validDepartments = ['Engineering', 'Housekeeping'];
    if (!validDepartments.includes(department)) {
        return { isValid: false, error: 'Invalid department' };
    }
    
    return { isValid: true, value: department };
}

// Handle add order
async function handleAddOrder(e) {
    e.preventDefault();
    
    const formData = new FormData(addOrderForm);
    const roomNumber = formData.get('roomNumber');
    const department = formData.get('department');
    const notes = formData.get('notes');
    
    // Validate input on frontend
    const roomNumberValidation = validateRoomNumber(roomNumber);
    const notesValidation = validateNotes(notes);
    const departmentValidation = validateDepartment(department);
    
    if (!roomNumberValidation.isValid) {
        alert(roomNumberValidation.error);
        return;
    }
    
    if (!notesValidation.isValid) {
        alert(notesValidation.error);
        return;
    }
    
    if (!departmentValidation.isValid) {
        alert(departmentValidation.error);
        return;
    }
    
    if (!currentToken) {
        console.error('You are not logged in. Please log in again.');
        return;
    }
    
    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ 
                roomNumber: roomNumberValidation.value, 
                department: departmentValidation.value, 
                notes: notesValidation.value 
            })
        });
        
        if (response.ok) {
            hideAddOrderModal();
            // Small delay to ensure server has processed the new order
            setTimeout(() => {
                loadOrders(); // This will refresh the list and show the new order
            }, 500);
        } else {
            const errorData = await response.json();
            console.error('Failed to add order:', errorData);
            alert(errorData.error || 'Failed to add order');
        }
    } catch (error) {
        console.error('Error adding order:', error);
        alert('An error occurred while adding the order');
    }
}

// Update active tab
function updateActiveTab() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.department === currentDepartment) {
            btn.classList.add('active');
        }
    });
}





// Date filter handlers
function handleDateFilter() {
    currentDateFilter = dateFilter.value;
    console.log('Date filter changed to:', currentDateFilter);
    loadOrders();
}

function clearDateFilterHandler() {
    currentDateFilter = null;
    dateFilter.value = '';
    console.log('Date filter cleared');
    loadOrders();
}



// ============================================================================
// DARK MODE FUNCTIONALITY
// ============================================================================

// Initialize dark mode on page load
function initializeDarkMode() {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
}

// ============================================================================
// SETTINGS MENU FUNCTIONALITY
// ============================================================================

/**
 * Toggle settings menu open/closed
 */
function toggleSettingsMenu() {
    const settingsDropdown = document.getElementById('settingsDropdown');
    if (settingsDropdown) {
        settingsMenuOpen = !settingsMenuOpen;
        if (settingsMenuOpen) {
            settingsDropdown.classList.add('active');
        } else {
            settingsDropdown.classList.remove('active');
        }
    }
}

function openManagerDashboard() {
    try {
        const win = window.open('manager.html', '_blank', 'noopener,noreferrer');
        if (win && typeof win.focus === 'function') {
            win.focus();
        }
    } catch (e) {
        // Fallback to same-tab navigation if popup blocked
        window.location.href = 'manager.html';
    }
}

// Toggle between light and dark themes
function toggleDarkMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    
    // Close settings menu after toggling
    const settingsDropdown = document.getElementById('settingsDropdown');
    if (settingsDropdown) {
        settingsDropdown.classList.remove('active');
        settingsMenuOpen = false;
    }
}

// Set the theme and update UI
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // Update theme toggle button icon and text in settings menu
    const themeIcon = document.getElementById('themeIcon');
    const themeText = document.getElementById('themeText');
    
    if (themeIcon) {
        themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    
    if (themeText) {
        themeText.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }
    
    // Update meta theme color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f5f5f5');
    }
}

// Check if user prefers dark mode from system settings
function prefersDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Auto-detect system preference on first visit
function autoDetectTheme() {
    if (!localStorage.getItem('theme')) {
        const systemPrefersDark = prefersDarkMode();
        setTheme(systemPrefersDark ? 'dark' : 'light');
    }
}

// ============================================================================
// MULTILINGUAL SUPPORT
// ============================================================================



// Toggle language (wrapper for settings menu)
function toggleLanguage() {
    toggleKeyboardLanguage();
    
    // Close settings menu after toggling
    const settingsDropdown = document.getElementById('settingsDropdown');
    if (settingsDropdown) {
        settingsDropdown.classList.remove('active');
        settingsMenuOpen = false;
    }
}

// Toggle keyboard language for the entire application (English/Arabic only)
function toggleKeyboardLanguage() {
    const currentLangElement = document.getElementById('currentLanguage');
    const currentLang = currentLangElement ? currentLangElement.textContent : 'EN';
    let newLang = 'EN';
    
    // Toggle between English and Arabic only
    if (currentLang === 'EN') {
        newLang = 'AR';
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'ar');
    } else {
        newLang = 'EN';
        document.documentElement.setAttribute('dir', 'ltr');
        document.documentElement.setAttribute('lang', 'en');
    }
    
    // Update language display in settings menu
    if (currentLangElement) {
        currentLangElement.textContent = newLang;
    }
    
    localStorage.setItem('currentLanguage', newLang);
    
    // Update UI language
    updateUILanguage(newLang);
}

// Update UI text based on selected language (English/Arabic only)
function updateUILanguage(language) {
    const languageMap = {
        'EN': {
            addOrder: 'Add Order',
            cancel: 'Cancel',
            logout: 'Logout',
            filterByDate: 'Filter by Date',
            clear: 'Clear',
            engineering: 'Engineering',
            housekeeping: 'Housekeeping',
            roomNumber: 'Room Number *',
            department: 'Department *',
            notes: 'Notes'
        },
        'AR': {
            addOrder: 'إضافة طلب',
            cancel: 'إلغاء',
            logout: 'تسجيل خروج',
            filterByDate: 'تصفية حسب التاريخ',
            clear: 'مسح',
            engineering: 'هندسة',
            housekeeping: 'خدمات الغرف',
            roomNumber: 'رقم الغرفة *',
            department: 'القسم *',
            notes: 'ملاحظات'
        }
    };
    
    const texts = languageMap[language] || languageMap['EN'];
    
    // Update button texts
    if (cancelOrderBtn) cancelOrderBtn.textContent = texts.cancel;
    // Logout is now in settings menu, no need to update here
    if (clearDateFilter) clearDateFilter.textContent = texts.clear;
    
    // Update labels
    const roomNumberLabel = document.querySelector('label[for="orderRoomNumber"]');
    const departmentLabel = document.querySelector('label[for="orderDepartment"]');
    const notesLabel = document.querySelector('label[for="orderNotes"]');
    const dateFilterLabel = document.querySelector('label[for="dateFilter"]');
    
    if (roomNumberLabel) roomNumberLabel.textContent = texts.roomNumber;
    if (departmentLabel) departmentLabel.textContent = texts.department;
    if (notesLabel) notesLabel.textContent = texts.notes;
    if (dateFilterLabel) dateFilterLabel.textContent = `📅 ${texts.filterByDate}`;
    
    // Update tab buttons
    const engineeringTab = document.querySelector('.tab-btn[data-department="Engineering"]');
    const housekeepingTab = document.querySelector('.tab-btn[data-department="Housekeeping"]');
    
    if (engineeringTab) engineeringTab.textContent = `🔧 ${texts.engineering}`;
    if (housekeepingTab) housekeepingTab.textContent = `🧹 ${texts.housekeeping}`;
}

// Initialize language settings
function initializeLanguage() {
    const savedLanguage = localStorage.getItem('currentLanguage') || 'EN';
    const currentLangElement = document.getElementById('currentLanguage');
    
    if (currentLangElement) {
        currentLangElement.textContent = savedLanguage;
    }
    
    // Apply initial language settings
    updateUILanguage(savedLanguage);
    
    // Add input event listener to automatically detect Arabic text
    if (orderNotes) {
        orderNotes.addEventListener('input', autoDetectArabicText);
    }
}

// Automatically detect Arabic text and apply RTL styling
function autoDetectArabicText(event) {
    const textarea = event.target;
    const text = textarea.value;
    
    // Check if text contains Arabic characters
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const hasArabic = arabicRegex.test(text);
    
    if (hasArabic) {
        textarea.style.direction = 'rtl';
        textarea.style.textAlign = 'right';
        textarea.style.fontFamily = "'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";
    } else {
        textarea.style.direction = 'ltr';
        textarea.style.textAlign = 'left';
        textarea.style.fontFamily = 'inherit';
    }
}

// ============================================================================
// LOGS FUNCTIONALITY
// ============================================================================

// Show logs modal
function showLogsModal() {
    if (logsModal) {
        logsModal.style.display = 'flex';
        switchLogsTab('deleted');
        // Close settings menu
        const settingsDropdown = document.getElementById('settingsDropdown');
        if (settingsDropdown) {
            settingsDropdown.classList.remove('active');
            settingsMenuOpen = false;
        }
    }
}

// Hide logs modal
function hideLogsModal() {
    if (logsModal) {
        logsModal.style.display = 'none';
    }
}

// Switch logs tab
function switchLogsTab(tab) {
    // Update tab buttons
    document.querySelectorAll('[data-tab]').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Show/hide sections
    const deletedSection = document.getElementById('deletedLogs');
    const editedSection = document.getElementById('editedLogs');
    const holdSection = document.getElementById('holdLogs');
    const logsDateFilter = document.getElementById('logsDateFilter');
    const filterDate = logsDateFilter ? logsDateFilter.value : null;
    
    if (tab === 'deleted') {
        if (deletedSection) deletedSection.style.display = 'block';
        if (editedSection) editedSection.style.display = 'none';
        if (holdSection) holdSection.style.display = 'none';
        loadLogs('deleted', filterDate);
    } else if (tab === 'edited') {
        if (deletedSection) deletedSection.style.display = 'none';
        if (editedSection) editedSection.style.display = 'block';
        if (holdSection) holdSection.style.display = 'none';
        loadLogs('edited', filterDate);
    } else if (tab === 'hold') {
        if (deletedSection) deletedSection.style.display = 'none';
        if (editedSection) editedSection.style.display = 'none';
        if (holdSection) holdSection.style.display = 'block';
        loadLogs('hold', filterDate);
    }
}

// Load logs
async function loadLogs(type, filterDate = null) {
    try {
        let url = `/api/logs?type=${type}`;
        if (filterDate) {
            url += `&date=${filterDate}`;
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            displayLogs(data.logs, type);
        } else {
            console.error('Failed to load logs');
        }
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

// Display logs
function displayLogs(logs, type) {
    const listId = type === 'deleted' ? 'deletedLogsList' : type === 'edited' ? 'editedLogsList' : 'holdLogsList';
    const listElement = document.getElementById(listId);
    
    if (!listElement) return;
    
    if (logs.length === 0) {
        listElement.innerHTML = `
            <div class="empty-state">
                <h3>No ${type} orders</h3>
                <p>No ${type} orders found in the logs.</p>
            </div>
        `;
        return;
    }
    
    listElement.innerHTML = '';
    
    logs.forEach(log => {
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        
        const oldData =
            typeof log.old_data === 'string'
                ? JSON.parse(log.old_data)
                : log.old_data;

        const newData =
            typeof log.new_data === 'string'
                ? JSON.parse(log.new_data)
                : log.new_data;

        
        const orderName = oldData?.order_name || newData?.order_name || 'Unknown';
        const roomNumber = orderName.replace('Room ', '');
        const changedAt = new Date(log.created_at).toLocaleString();
        const changedBy = log.changed_by_full_name || log.changed_by_name || 'Unknown';
        const department = log.order_type === 'engineering' ? 'Engineering' : 'Housekeeping';
        
        let detailsHtml = '';
        if (type === 'edited' && oldData && newData) {
            detailsHtml = `
                <div class="log-details">
                    <strong>Changes:</strong><br>
                    ${oldData.order_name !== newData.order_name ? 
                        `Order Name: "${oldData.order_name}" → "${newData.order_name}"<br>` : ''}
                    ${oldData.order_notes !== newData.order_notes ? 
                        `Notes: "${oldData.order_notes || ''}" → "${newData.order_notes || ''}"<br>` : ''}
                </div>
            `;
        } else if (type === 'deleted' && oldData) {
            detailsHtml = `
                <div class="log-details">
                    <strong>Deleted Order Details:</strong><br>
                    Room: ${roomNumber}<br>
                    Department: ${department}<br>
                    ${oldData.order_notes ? `Notes: ${escapeHtml(oldData.order_notes)}<br>` : ''}
                </div>
            `;
        } else if (type === 'hold' && newData) {
            detailsHtml = `
                <div class="log-details">
                    <strong>Hold Details:</strong><br>
                    Status: ${escapeHtml(newData.hold_info || 'On Hold')}<br>
                    ${newData.hold_reason ? `Reason: ${escapeHtml(newData.hold_reason)}<br>` : ''}
                </div>
            `;
        }
        
        logItem.innerHTML = `
            <div class="log-header">
                <div class="log-title">Room ${escapeHtml(roomNumber)} - ${department}</div>
                <div class="log-meta">${escapeHtml(changedAt)}</div>
            </div>
            <div class="log-description">
                ${escapeHtml(log.change_description || `${type === 'deleted' ? 'Deleted' : 'Edited'} by ${changedBy}`)}
            </div>
            ${detailsHtml}
        `;
        
        listElement.appendChild(logItem);
    });
}

// ============================================================================
// EDIT ORDER FUNCTIONALITY
// ============================================================================

// Show edit order modal
function showEditOrderModal(order) {
    orderToEdit = order;
    
    if (editOrderModal && editOrderForm) {
        // Extract room number from order_name
        const roomNumber = order.order_name ? order.order_name.replace('Room ', '') : '';
        
        document.getElementById('editOrderRoomNumber').value = roomNumber;
        document.getElementById('editOrderDepartment').value = currentDepartment;
        document.getElementById('editOrderNotes').value = order.order_notes || '';
        
        editOrderModal.style.display = 'flex';
    }
}

// Hide edit order modal
function hideEditOrderModal() {
    if (editOrderModal) {
        editOrderModal.style.display = 'none';
        orderToEdit = null;
        if (editOrderForm) {
            editOrderForm.reset();
        }
    }
}

// Handle edit order form submission
async function handleEditOrder(event) {
    event.preventDefault();
    
    if (!orderToEdit) return;
    
    const formData = new FormData(event.target);
    const roomNumber = formData.get('roomNumber');
    const department = formData.get('department');
    const notes = formData.get('notes');
    
    const orderName = `Room ${roomNumber}`;
    
    try {
        const response = await fetch(`/api/orders/${orderToEdit.id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_name: orderName,
                order_notes: notes,
                department: department
            })
        });
        
        if (response.ok) {
            hideEditOrderModal();
            // Reload orders to show updated data
            setTimeout(() => {
                loadOrders();
            }, 500);
        } else {
            const error = await response.json();
            console.error('Failed to edit order:', error);
            alert('Failed to edit order. Please try again.');
        }
    } catch (error) {
        console.error('Error editing order:', error);
        alert('Error editing order. Please try again.');
    }
}

// Process Arabic text in order notes for proper display
function processArabicText(element) {
    const text = element.textContent || element.innerText;
    
    // Check if text contains Arabic characters
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const hasArabic = arabicRegex.test(text);
    
    if (hasArabic) {
        // Apply RTL styling for Arabic text
        element.style.direction = 'rtl';
        element.style.textAlign = 'right';
        element.style.fontFamily = "'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";
        element.style.fontSize = '1.1rem';
        element.style.lineHeight = '1.8';
        
        // Ensure proper text rendering
        element.style.unicodeBidi = 'bidi-override';
        element.style.textRendering = 'optimizeLegibility';
        
        // Add Arabic-specific CSS class
        element.classList.add('arabic-text');
    } else {
        // Reset to default styling for non-Arabic text
        element.style.unicodeBidi = 'normal';
        element.style.textRendering = 'auto';
        
        // Remove Arabic-specific CSS class
        element.classList.remove('arabic-text');
    }
}

// Process all Arabic text in the current order display
function processAllArabicText() {
    const notesElements = document.querySelectorAll('.order-notes');
    notesElements.forEach(element => {
        processArabicText(element);
    });
}