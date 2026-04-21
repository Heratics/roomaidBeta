// ============================================================================
// RoomAid Guest (Customer) Portal
// ============================================================================

let authToken = null;
let currentUser = null;
let orderToCancel = null;

const app = document.getElementById('customerApp');
const themeToggle = document.getElementById('themeToggle');

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
    initializeDarkMode();
    autoDetectTheme();
    setupThemeToggle();

    const savedToken = localStorage.getItem('authToken');
    const savedUser  = localStorage.getItem('user');

    if (savedToken && savedUser) {
        try {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            if (currentUser.role !== 'customer') {
                // Not a customer — send back to main dashboard
                window.location.href = 'index.html';
                return;
            }
            renderPortal();
            loadOrders();
        } catch (e) {
            clearSession();
            renderLogin();
        }
    } else {
        renderLogin();
    }
});

// ---- Render: Login ----
function renderLogin() {
    if (!app) return;
    app.innerHTML = `
        <div class="screen">
            <div class="login-container">
                <div class="login-header">
                    <div class="brand-container">
                        <img src="rubbletech-removebg-preview.png" alt="RoomAid" class="roomaid-logo-small" onerror="this.style.display='none'">
                        <div class="brand-text">
                            <h1>RoomAid</h1>
                            <p>Guest Portal</p>
                        </div>
                    </div>
                </div>
                <form id="guestLoginForm" class="login-form">
                    <div class="form-group">
                        <label for="guestUsername">Room Username</label>
                        <input type="text" id="guestUsername" name="username" required autocomplete="username" placeholder="e.g. room_101">
                    </div>
                    <div class="form-group">
                        <label for="guestPassword">Password</label>
                        <div class="password-container">
                            <input type="password" id="guestPassword" name="password" required autocomplete="current-password">
                            <button type="button" id="toggleGuestPwd" class="password-toggle">🙈</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="guestHotelCode">Hotel Code</label>
                        <input type="text" id="guestHotelCode" name="hotelCode" required placeholder="e.g. HOTEL001">
                    </div>
                    <button class="btn btn-primary" type="submit">Sign In</button>
                    <div id="guestLoginError" class="error-message" style="display:none;"></div>
                </form>
            </div>
        </div>
    `;

    document.getElementById('guestLoginForm').addEventListener('submit', handleGuestLogin);
    const pwdInput = document.getElementById('guestPassword');
    document.getElementById('toggleGuestPwd').addEventListener('click', () => {
        const t = pwdInput.type === 'password' ? 'text' : 'password';
        pwdInput.type = t;
        document.getElementById('toggleGuestPwd').textContent = t === 'password' ? '🙈' : '👁️';
    });
}

async function handleGuestLogin(e) {
    e.preventDefault();
    const username  = document.getElementById('guestUsername').value.trim();
    const password  = document.getElementById('guestPassword').value;
    const hotelCode = document.getElementById('guestHotelCode').value.trim().toUpperCase();

    if (!username || !password || !hotelCode) {
        return showGuestLoginError('All fields are required.');
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, hotelCode })
        });
        const data = await res.json();

        if (!res.ok) return showGuestLoginError(data.error || 'Login failed.');

        if (data.user.role !== 'customer') {
            return showGuestLoginError('This portal is for room/guest accounts only.');
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        renderPortal();
        loadOrders();
    } catch (err) {
        console.error('Guest login error:', err);
        showGuestLoginError('Login error. Please try again.');
    }
}

function showGuestLoginError(msg) {
    const el = document.getElementById('guestLoginError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ---- Render: Portal shell ----
function renderPortal() {
    const roomLabel = currentUser.room_number
        ? `Room ${currentUser.room_number}`
        : currentUser.username;
    const hotelLabel = currentUser.hotelName || currentUser.hotelCode || '';

    app.innerHTML = `
        <div class="customer-header">
            <div class="customer-header-left">
                <h1>🏨 ${escapeHtml(hotelLabel)}</h1>
                <p>Guest Service Portal</p>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                <div class="room-badge">${escapeHtml(roomLabel)}</div>
                <button class="logout-btn" id="logoutBtn">Sign Out</button>
            </div>
        </div>

        <div class="customer-actions">
            <button class="request-btn" id="newRequestBtn">🛎️ New Service Request</button>
            <button class="refresh-btn" id="refreshBtn">🔄 Refresh</button>
        </div>

        <h2 class="section-title">📋 My Requests</h2>
        <div id="ordersContainer" class="orders-grid">
            <p style="color:var(--text-secondary);">Loading...</p>
        </div>
    `;

    document.getElementById('newRequestBtn').addEventListener('click', openRequestModal);
    document.getElementById('refreshBtn').addEventListener('click', loadOrders);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    setupModals();
}

// ---- Load & display orders ----
async function loadOrders() {
    try {
        const res = await fetch('/api/customer/orders', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401 || res.status === 403) {
            clearSession(); renderLogin(); return;
        }

        const data = await res.json();
        renderOrders(data.orders || []);
    } catch (err) {
        console.error('Load orders error:', err);
        const container = document.getElementById('ordersContainer');
        if (container) container.innerHTML = `<p style="color:var(--brand-danger,#ef4444);">Failed to load orders. Please refresh.</p>`;
    }
}

function renderOrders(orders) {
    const container = document.getElementById('ordersContainer');
    if (!container) return;

    if (!orders || orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🛎️</div>
                <p>No service requests yet.</p>
                <p style="font-size:0.9rem;">Tap "New Service Request" above to get help.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = orders.map(o => {
        const statusInfo  = getStatusInfo(o);
        const canCancel   = !o.completed_at && !o.on_hold && !o.deleted_at;
        const createdDate = formatDate(o.created_at);
        const assignedStaffName = o.receiverName || o.receiverUsername || '';
        const isAssignedToStaff = Boolean(o.assigned_to) && String(o.assigned_to) !== String(o.sent_by);

        return `
            <div class="order-card">
                <div class="order-card-header">
                    <div>
                        <div class="order-card-title">${escapeHtml(o.order_name)}</div>
                        <span class="order-card-dept">${escapeHtml(o.department)}</span>
                    </div>
                    <span class="status-badge ${statusInfo.cls}">${statusInfo.icon} ${statusInfo.label}</span>
                </div>
                ${o.order_notes ? `<div class="order-card-notes">${escapeHtml(o.order_notes)}</div>` : ''}
                <div class="order-card-meta">
                    <span>📅 ${createdDate}</span>
                    ${isAssignedToStaff && assignedStaffName ? `<span>👤 Assigned: ${escapeHtml(assignedStaffName)}</span>` : ''}
                    ${o.on_hold && o.hold_info ? `<span>⏸️ ${escapeHtml(o.hold_info)}</span>` : ''}
                    ${canCancel ? `<button class="cancel-order-btn" data-id="${o.id}">✕ Cancel</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Bind cancel buttons
    container.querySelectorAll('.cancel-order-btn').forEach(btn => {
        btn.addEventListener('click', () => openCancelModal(btn.dataset.id));
    });
}

function getStatusInfo(o) {
    if (o.deleted_at)   return { cls: 'status-cancelled', icon: '✕', label: 'Cancelled' };
    if (o.completed_at) return { cls: 'status-completed', icon: '✅', label: 'Completed' };
    if (o.on_hold)      return { cls: 'status-on-hold',   icon: '⏸️', label: 'On Hold'   };
    if (o.assigned_to && String(o.assigned_to) !== String(o.sent_by)) {
        return { cls: 'status-received', icon: '🔵', label: 'Being Worked On' };
    }
    return                     { cls: 'status-open',      icon: '🟡', label: 'Pending'   };
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- Request Modal ----
function setupModals() {
    // Request modal
    const requestModal  = document.getElementById('requestModal');
    const requestForm   = document.getElementById('requestForm');
    const cancelBtn     = document.getElementById('cancelRequestBtn');
    const closeReqBtn   = document.getElementById('closeRequestModal');
    const deptGrid      = document.getElementById('deptGrid');

    if (closeReqBtn) closeReqBtn.addEventListener('click', closeRequestModal);
    if (cancelBtn)   cancelBtn.addEventListener('click', closeRequestModal);
    if (requestForm) requestForm.addEventListener('submit', handleNewRequest);

    if (deptGrid) {
        deptGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('.dept-option');
            if (!btn) return;
            deptGrid.querySelectorAll('.dept-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            document.getElementById('selectedDept').value = btn.dataset.dept;
        });
    }

    // Cancel modal
    const cancelModal   = document.getElementById('cancelModal');
    const closeCanBtn   = document.getElementById('closeCancelModal');
    const keepBtn       = document.getElementById('keepOrderBtn');
    const confirmCanBtn = document.getElementById('confirmCancelBtn');
    const cancelReason  = document.getElementById('cancelReasonInput');

    if (closeCanBtn) closeCanBtn.addEventListener('click', closeCancelModal);
    if (keepBtn)     keepBtn.addEventListener('click', closeCancelModal);
    if (confirmCanBtn) confirmCanBtn.addEventListener('click', handleCancelOrder);

    // Quick suggestion buttons for cancel reason
    document.querySelectorAll('[data-cancel-reason]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (cancelReason) cancelReason.value = btn.dataset.cancelReason;
        });
    });

    // Close modals when clicking backdrop
    [requestModal, cancelModal].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        }
    });
}

function openRequestModal() {
    const modal = document.getElementById('requestModal');
    if (!modal) return;
    // Reset form
    document.getElementById('selectedDept').value = '';
    document.getElementById('requestNotes').value = '';
    const err = document.getElementById('requestError');
    if (err) err.style.display = 'none';
    document.querySelectorAll('#deptGrid .dept-option').forEach(b => b.classList.remove('selected'));
    modal.style.display = 'flex';
}

function closeRequestModal() {
    const modal = document.getElementById('requestModal');
    if (modal) modal.style.display = 'none';
}

async function handleNewRequest(e) {
    e.preventDefault();
    const dept  = document.getElementById('selectedDept').value;
    const notes = document.getElementById('requestNotes').value.trim();
    const errEl = document.getElementById('requestError');
    const submitBtn = document.getElementById('submitRequestBtn');

    if (!dept) {
        if (errEl) { errEl.textContent = 'Please select a department.'; errEl.style.display = 'block'; }
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
        const res = await fetch('/api/customer/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ department: dept, notes })
        });

        const data = await res.json();

        if (!res.ok) {
            if (errEl) { errEl.textContent = data.error || 'Failed to send request.'; errEl.style.display = 'block'; }
            return;
        }

        closeRequestModal();
        loadOrders();
    } catch (err) {
        console.error('New request error:', err);
        if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display = 'block'; }
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Request';
    }
}

// ---- Cancel Modal ----
function openCancelModal(orderId) {
    orderToCancel = orderId;
    const modal = document.getElementById('cancelModal');
    if (!modal) return;
    const reasonInput = document.getElementById('cancelReasonInput');
    const errEl       = document.getElementById('cancelReasonError');
    if (reasonInput) reasonInput.value = '';
    if (errEl)       errEl.style.display = 'none';
    modal.style.display = 'flex';
}

function closeCancelModal() {
    orderToCancel = null;
    const modal = document.getElementById('cancelModal');
    if (modal) modal.style.display = 'none';
}

async function handleCancelOrder() {
    if (!orderToCancel) return;

    const reason  = document.getElementById('cancelReasonInput')?.value.trim();
    const errEl   = document.getElementById('cancelReasonError');
    const confirmBtn = document.getElementById('confirmCancelBtn');

    if (!reason) {
        if (errEl) { errEl.textContent = 'Please provide a reason.'; errEl.style.display = 'block'; }
        return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Cancelling...';

    try {
        const res = await fetch(`/api/customer/orders/${orderToCancel}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
        });

        const data = await res.json();

        if (!res.ok) {
            if (errEl) { errEl.textContent = data.error || 'Could not cancel order.'; errEl.style.display = 'block'; }
            return;
        }

        closeCancelModal();
        loadOrders();
    } catch (err) {
        console.error('Cancel order error:', err);
        if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display = 'block'; }
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Cancel Order';
    }
}

// ---- Auth helpers ----
async function handleLogout() {
    try {
        if (authToken) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
        }
    } catch (e) { /* ignore */ }
    clearSession();
    window.location.href = '/';
}

function clearSession() {
    authToken   = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
}

// ---- Theme helpers ----
function setupThemeToggle() {
    if (!themeToggle) return;
    themeToggle.addEventListener('click', toggleDarkMode);
    updateThemeIcon();
}

function initializeDarkMode() {
    const saved = localStorage.getItem('theme') || 'light';
    setTheme(saved);
}

function autoDetectTheme() {
    if (!localStorage.getItem('theme')) {
        setTheme(window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
}

function toggleDarkMode() {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeIcon();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#4CAF50');
}

function updateThemeIcon() {
    if (!themeToggle) return;
    const cur = document.documentElement.getAttribute('data-theme');
    themeToggle.textContent = cur === 'dark' ? '🌙' : '☀️';
}

// ---- Utility ----
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
