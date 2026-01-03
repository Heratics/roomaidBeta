// Global state
let currentUser = null;
let currentToken = null;
let currentDepartment = 'Engineering';
let currentDateFilter = null;
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 10000; // Refresh every 10 seconds

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

const holdOrderTimeModal = document.getElementById('holdOrderTimeModal');
const closeHoldTimeModalBtn = document.getElementById('closeHoldTimeModalBtn');
const holdTimeFrameInput = document.getElementById('holdTimeFrameInput');
const cancelHoldTimeBtn = document.getElementById('cancelHoldTimeBtn');
const confirmHoldTimeBtn = document.getElementById('confirmHoldTimeBtn');

let orderToHold = null;
let holdOrderDay = null;

// Logs modal elements
const logsModal = document.getElementById('logsModal');
const closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
const logsMenuItem = document.getElementById('logsMenuItem');

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
    const savedToken = sessionStorage.getItem('authToken');
    const savedUser = sessionStorage.getItem('user');
    
    if (savedToken && savedUser) {
        currentToken = savedToken;
        currentUser = JSON.parse(savedUser);
        // Show logs button for manager/admin/supervisor only
        if (logsMenuItem && currentUser && (currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'supervisor')) {
            logsMenuItem.style.display = 'flex';
        }
        showDashboard();
    } else {
        // User not logged in, redirect to login page
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
    
    // Date filter
    if (dateFilter) {
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
    
    // Hold order modals
    if (closeHoldDayModalBtn) {
        closeHoldDayModalBtn.addEventListener('click', hideHoldOrderDayModal);
    }
    
    if (holdSameDayBtn) {
        holdSameDayBtn.addEventListener('click', () => {
            holdOrderDay = 'same-day';
            hideHoldOrderDayModal();
            showHoldOrderTimeModal();
        });
    }
    
    if (holdNextDayBtn) {
        holdNextDayBtn.addEventListener('click', () => {
            holdOrderDay = 'next-day';
            confirmHoldOrder();
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
    
    // Quick time suggestions for hold order
    document.querySelectorAll('.quick-suggestion-btn[data-time]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            holdTimeFrameInput.value = e.target.dataset.time;
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
    
    // Quick suggestion buttons for deletion reason
    document.querySelectorAll('.quick-suggestion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            deletionReasonInput.value = e.target.dataset.reason;
        });
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
    orderToHold = null;
    holdOrderDay = null;
}

// Show hold order time frame modal
function showHoldOrderTimeModal() {
    holdOrderTimeModal.style.display = 'flex';
}

// Hide hold order time frame modal
function hideHoldOrderTimeModal() {
    holdOrderTimeModal.style.display = 'none';
    holdTimeFrameInput.value = '';
}

// Confirm hold order
async function confirmHoldOrder() {
    if (!orderToHold) {
        return;
    }
    
    const holdData = {
        day: holdOrderDay,
        timeFrame: holdOrderDay === 'same-day' ? holdTimeFrameInput.value : null
    };
    
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
        
        if (response.ok) {
            hideHoldOrderDayModal();
            hideHoldOrderTimeModal();
            // Small delay to ensure server has processed the hold
            setTimeout(() => {
                loadOrders(); // Reload orders to show updated status
            }, 500);
        } else {
            console.error('Failed to hold order');
            alert('Failed to hold order. Please try again.');
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
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('user');
    
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
}



// Load orders for current department
async function loadOrders() {
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
            displayOrders(data.orders);
        } else {
            console.error('Failed to load orders, status:', response.status);
            displayOrders([]);
        }
    } catch (error) {
        console.error('Error loading orders:', error);
        displayOrders([]);
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
            <div class="order-title">Room ${roomNumber}</div>
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