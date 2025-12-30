// Global state
let currentUser = null;
let currentToken = null;
let currentDepartment = 'Engineering';
let currentDateFilter = null;

// DOM elements
const dashboardScreen = document.getElementById('dashboardScreen');
const logoutBtn = document.getElementById('logoutBtn');
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
const themeToggle = document.getElementById('themeToggle');
const orderNotes = document.getElementById('orderNotes');
const currentLanguage = document.getElementById('currentLanguage');
const toggleLanguageBtn = document.getElementById('toggleLanguageBtn');

// Delete confirmation modal elements
const deleteConfirmModal = document.getElementById('deleteConfirmModal');
const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    // Check if all required DOM elements exist
    if (!dashboardScreen || !logoutBtn || !addOrderBtn || !ordersList) {
        console.error('Required DOM elements not found. Dashboard may not function properly.');
    }
    
    // Initialize dark mode
    initializeDarkMode();
    autoDetectTheme();
    
    // Initialize language support
    initializeLanguage();
    
    // Check if user has an active session
    const savedToken = sessionStorage.getItem('authToken');
    const savedUser = sessionStorage.getItem('user');
    
    if (savedToken && savedUser) {
        currentToken = savedToken;
        currentUser = JSON.parse(savedUser);
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
    // Logout
    logoutBtn.addEventListener('click', handleLogout);
    
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
    
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', confirmDeleteOrder);
    }
    
    // Dark mode toggle
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleDarkMode);
    }
    
    // Language toggle
    if (toggleLanguageBtn) {
        toggleLanguageBtn.addEventListener('click', toggleKeyboardLanguage);
    }
}



// Logout handler
async function handleLogout() {
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
                                 <button class="btn btn-danger delete-btn" data-order-id="${escapeHtml(order.id)}">🗑</button>
            </div>
        </div>
        
        <div class="order-meta">
            <span>📅 ${escapeHtml(createdAt)}</span>
            <span>👤 ${creatorName}</span>
        </div>
        
        ${orderNotes ? `<div class="order-notes" data-notes="${escapeHtml(order.order_notes)}">${orderNotes}</div>` : ''}
        
        ${isReceived ? `
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
    
    const deleteBtn = card.querySelector('.delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            deleteOrder(order.id);
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
            loadOrders(); // Reload orders to show updated status
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
            // Reload orders
            loadOrders();
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
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (response.ok) {
            // Reload orders
            loadOrders();
            hideDeleteConfirmModal();
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
            loadOrders(); // This will refresh the list and show the new order
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

// Toggle between light and dark themes
function toggleDarkMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

// Set the theme and update UI
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // Update theme toggle button icon
    if (themeToggle) {
        themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
        themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
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



// Toggle keyboard language for the entire application (English/Arabic only)
function toggleKeyboardLanguage() {
    const currentLang = currentLanguage.textContent;
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
    
    currentLanguage.textContent = newLang;
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
    if (logoutBtn) logoutBtn.textContent = texts.logout;
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
    
    currentLanguage.textContent = savedLanguage;
    
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