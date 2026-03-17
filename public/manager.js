// Manager Dashboard Script
let authToken = null;
let currentUser = null;
let currentTab = 'users';
let usersCache = [];
let editingUserId = null;

const root = document.getElementById('manager-root');
const themeToggle = document.getElementById('themeToggle');

// Boot
document.addEventListener('DOMContentLoaded', () => {
    initializeDarkMode();
    autoDetectTheme();
    setupThemeToggle();
    bootstrapSession();
    // Don't clear session on tab close - let localStorage persist the session
});

function bootstrapSession() {
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');

    if (savedToken && savedUser) {
        try {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            renderDashboard();
            loadUsers();
        } catch (error) {
            console.error('Error parsing saved user data:', error);
            // Clear corrupted session data and show login
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            renderLogin();
        }
    } else {
        renderLogin();
    }
}

// UI: Login
function renderLogin() {
    if (!root) return;

    root.innerHTML = `
        <div class="screen">
            <div class="login-container">
                <div class="login-header">
                    <div class="brand-container">
                        <img src="rubbletech-removebg-preview.png" alt="RoomAid Logo" class="roomaid-logo-small" onerror="this.style.display='none';">
                        <div class="brand-text">
                            <h1>RoomAid</h1>
                            <p>by Rubble Tech</p>
                        </div>
                    </div>
                    <p>Manager Login</p>
                </div>
                <form id="managerLoginForm" class="login-form">
                    <div class="form-group">
                        <label for="managerUsername">Username</label>
                        <input type="text" id="managerUsername" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="managerPassword">Password</label>
                        <div class="password-container">
                            <input type="password" id="managerPassword" name="password" required>
                            <button type="button" id="managerTogglePassword" class="password-toggle">🙈</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="managerHotelCode">Hotel Code</label>
                        <input type="text" id="managerHotelCode" name="hotelCode" required placeholder="HOTEL001">
                    </div>
                    <button class="btn btn-primary" type="submit">Sign In</button>
                    <div id="managerLoginError" class="error-message" style="display:none;"></div>
                </form>
            </div>
        </div>
    `;

    const form = document.getElementById('managerLoginForm');
    if (form) {
        form.addEventListener('submit', handleManagerLogin);
    }

    const togglePasswordBtn = document.getElementById('managerTogglePassword');
    const passwordInput = document.getElementById('managerPassword');
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            togglePasswordBtn.textContent = type === 'password' ? '🙈' : '👁️';
        });
    }
}

async function handleManagerLogin(event) {
    event.preventDefault();
    const username = document.getElementById('managerUsername')?.value.trim();
    const password = document.getElementById('managerPassword')?.value;
    const hotelCode = document.getElementById('managerHotelCode')?.value.trim().toUpperCase();

    if (!username || !password || !hotelCode) {
        return showLoginError('All fields are required.');
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, hotelCode })
        });

        const data = await response.json();

        if (!response.ok) {
            const message = data?.error || 'Login failed. Check your details.';
            return showLoginError(message);
        }

        const allowedRoles = ['manager', 'supervisor', 'admin'];
        if (!allowedRoles.includes(data.user.role)) {
            return showLoginError('Manager access required for this dashboard.');
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        renderDashboard();
        loadUsers();
    } catch (error) {
        console.error('Manager login error:', error);
        showLoginError('Login error. Please try again.');
    }
}

function showLoginError(message) {
    const errorDiv = document.getElementById('managerLoginError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

// UI: Dashboard
function renderDashboard() {
    if (!root) return;

    const hotelLabel = currentUser?.hotelName || currentUser?.hotelCode || 'Your Hotel';
    root.innerHTML = `
        <div class="manager-header">
            <h1>Manager Dashboard</h1>
            <p>Hotel: ${hotelLabel}</p>
        </div>
        <div class="settings-bar">
            <button id="backToDashboardBtn" class="settings-btn">Back to Main Dashboard</button>
        </div>
        <div class="manager-nav">
            <button id="usersTab" class="nav-btn active" data-tab="users">Users</button>
            <button id="roomsTab" class="nav-btn" data-tab="rooms">🏨 Rooms</button>
            <button id="reportsTab" class="nav-btn" data-tab="reports">Reports</button>
        </div>
        <div id="users-section" class="manager-section active">
            <div class="flex-between">
                <h2 style="margin:0;">Team Members</h2>
                <input id="userSearch" class="search-input" type="search" placeholder="Search by name or username" aria-label="Search users">
            </div>
            <div id="usersLoading" class="loading" style="display:none;">Loading users...</div>
            <div id="usersError" class="alert alert-error" style="display:none;">Unable to load users.</div>
            <div id="usersEmpty" class="placeholder-card" style="display:none;">No users found for your hotel.</div>
            <div class="table-wrapper">
                <table class="users-table" id="usersTable" style="display:none;">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Username</th>
                            <th>Role</th>
                            <th style="width: 120px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="usersTbody"></tbody>
                </table>
            </div>
        </div>
        <div id="reports-section" class="manager-section">
            <div class="card">
                <div class="flex-between" style="gap:12px; align-items:flex-end; flex-wrap:wrap;">
                    <div>
                        <h3 style="margin:0 0 6px 0;">Daily Report</h3>
                        <p style="color:var(--text-secondary); margin:0;">Export all orders for your hotel on a selected day.</p>
                    </div>
                        <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end;">
                            <div class="form-group" style="margin:0;">
                                <label for="reportDate" style="margin-bottom:6px; display:block;">Date</label>
                                <input type="date" id="reportDate" style="min-width:200px;">
                            </div>
                            <button id="downloadReportBtn" class="btn btn-primary" style="height:44px; padding:0 18px; border-radius:10px; display:flex; align-items:center; gap:8px; box-shadow:0 6px 14px var(--shadow-primary);">
                                <span>⬇️</span>
                                <span>Download Excel (CSV)</span>
                            </button>
                        </div>
                </div>
                <div id="reportStatus" class="alert alert-error" style="display:none; margin-top:12px;"></div>
            </div>
        </div>

        <div id="rooms-section" class="manager-section">
            <h2 style="margin:0 0 20px 0;">🏨 Room Accounts</h2>

            <!-- Bulk Create Panel -->
            <div class="card" style="margin-bottom:20px;">
                <h3 style="margin:0 0 12px 0;">➕ Add Rooms</h3>
                <p style="color:var(--text-secondary); margin-bottom:14px; font-size:0.9rem;">Enter room numbers separated by commas, spaces, or new lines. A guest account will be created for each one with the username <code>room_{number}</code>.</p>
                <div class="form-group">
                    <label for="bulkRoomNumbers">Room Numbers</label>
                    <textarea id="bulkRoomNumbers" rows="4" placeholder="101, 102, 103&#10;201&#10;302" style="resize:vertical; font-family:monospace;"></textarea>
                </div>
                <div class="form-group">
                    <label for="bulkRoomPassword">Initial Password (for all rooms)</label>
                    <input type="text" id="bulkRoomPassword" placeholder="Min 4 characters">
                </div>
                <div id="bulkCreateStatus" style="display:none; padding:10px; border-radius:8px; margin-bottom:10px; font-size:0.9rem;"></div>
                <button id="bulkCreateBtn" class="btn btn-primary">Create Room Accounts</button>
            </div>

            <!-- Bulk Password Reset -->
            <div class="card" style="margin-bottom:20px;">
                <h3 style="margin:0 0 8px 0;">🔑 Reset All Room Passwords</h3>
                <p style="color:var(--text-secondary); margin-bottom:12px; font-size:0.9rem;">Set the same new password for every room account in this hotel.</p>
                <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
                    <div class="form-group" style="margin:0; flex:1; min-width:200px;">
                        <label for="bulkNewPassword">New Password</label>
                        <input type="text" id="bulkNewPassword" placeholder="Min 4 characters">
                    </div>
                    <button id="bulkPasswordBtn" class="btn btn-secondary" style="height:44px;">Reset All Passwords</button>
                </div>
                <div id="bulkPasswordStatus" style="display:none; margin-top:10px; padding:10px; border-radius:8px; font-size:0.9rem;"></div>
            </div>

            <!-- Room list -->
            <div class="flex-between" style="margin-bottom:12px;">
                <h3 style="margin:0;">Current Room Accounts</h3>
                <input id="roomSearch" class="search-input" type="search" placeholder="Search room..." style="max-width:200px;">
            </div>
            <div id="roomsLoading" style="display:none;">Loading rooms...</div>
            <div id="roomsError" class="alert alert-error" style="display:none;">Unable to load rooms.</div>
            <div id="roomsEmpty" class="placeholder-card" style="display:none;">No room accounts yet. Use the form above to create some.</div>
            <div class="table-wrapper">
                <table class="users-table" id="roomsTable" style="display:none;">
                    <thead>
                        <tr>
                            <th>Room</th>
                            <th>Username</th>
                            <th>New Password</th>
                            <th style="width:100px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="roomsTbody"></tbody>
                </table>
            </div>
        </div>

        <div id="editUserModal" class="modal" style="display:none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Edit User</h2>
                    <button id="closeEditModalBtn" class="close-btn" aria-label="Close">&times;</button>
                </div>
                <form id="editUserForm" class="modal-form">
                    <input type="hidden" id="editUserId">
                    <div class="form-group">
                        <label for="editFirstName">First Name</label>
                        <input type="text" id="editFirstName" required>
                    </div>
                    <div class="form-group">
                        <label for="editLastName">Last Name</label>
                        <input type="text" id="editLastName" required>
                    </div>
                    <div class="form-group">
                        <label for="editUsername">Username</label>
                        <input type="text" id="editUsername" required>
                    </div>
                    <div class="form-group">
                        <label for="editPassword">Password (leave blank to keep)</label>
                        <input type="password" id="editPassword" autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label for="editRole">Role</label>
                        <select id="editRole" required>
                            <option value="employee">Employee</option>
                            <option value="supervisor">Supervisor</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <div class="form-group" id="departmentFieldContainer" style="display:none;">
                        <label for="editDepartment">Department (for employees only)</label>
                        <select id="editDepartment">
                            <option value="">Select Department</option>
                            <option value="Engineering">Engineering</option>
                            <option value="Housekeeping">Housekeeping</option>
                            <option value="Laundry">Laundry</option>
                            <option value="Room Service">Room Service</option>
                        </select>
                    </div>
                    <div style="display:flex; gap:12px; justify-content:flex-end;">
                        <button type="button" class="btn-secondary" id="cancelEditBtn">Cancel</button>
                        <button type="submit" class="btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    attachDashboardEvents();
}

function attachDashboardEvents() {
    document.getElementById('usersTab')?.addEventListener('click', () => switchTab('users'));
    document.getElementById('roomsTab')?.addEventListener('click', () => { switchTab('rooms'); loadRooms(); });
    document.getElementById('reportsTab')?.addEventListener('click', () => switchTab('reports'));
    document.getElementById('backToDashboardBtn')?.addEventListener('click', goToMainDashboard);

    const searchInput = document.getElementById('userSearch');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            loadUsers(searchInput.value.trim());
        }, 300));
    }

    const reportDateInput = document.getElementById('reportDate');
    const downloadReportBtn = document.getElementById('downloadReportBtn');
    if (reportDateInput) {
        setDefaultReportDate(reportDateInput);
    }
    if (downloadReportBtn) {
        downloadReportBtn.addEventListener('click', downloadDailyReport);
    }

    const closeEditModalBtn = document.getElementById('closeEditModalBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const editUserForm = document.getElementById('editUserForm');
    const usersTable = document.getElementById('usersTable');

    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);
    if (editUserForm) editUserForm.addEventListener('submit', handleEditSubmit);
    if (usersTable) {
        usersTable.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target.matches('.edit-user-btn')) {
                const id = target.getAttribute('data-id');
                openEditModal(Number(id));
            }
        });
    }

    wireRoomsEvents();
}

function switchTab(tab) {
    currentTab = tab;
    const tabs = ['users', 'rooms', 'reports'];
    tabs.forEach(name => {
        const btn = document.querySelector(`[data-tab="${name}"]`);
        const section = document.getElementById(`${name}-section`);
        if (btn) btn.classList.toggle('active', name === tab);
        if (section) section.classList.toggle('active', name === tab);
    });
}

// Data
async function loadUsers(search = '') {
    if (!authToken) {
        return renderLogin();
    }

    setUsersState({ loading: true, error: false });

    try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);

        const response = await fetch(`/api/manager/users?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401 || response.status === 403) {
            clearManagerSession();
            renderLogin();
            return;
        }

        if (!response.ok) {
            throw new Error('Request failed');
        }

        const data = await response.json();
        usersCache = data.users || [];
        renderUsersTable(usersCache);
    } catch (error) {
        console.error('Load users error:', error);
        setUsersState({ error: true });
    } finally {
        setUsersState({ loading: false });
    }
}

function wireRoomsEvents() {
    const bulkCreateBtn = document.getElementById('bulkCreateBtn');
    if (bulkCreateBtn && !bulkCreateBtn.dataset.bound) {
        bulkCreateBtn.addEventListener('click', handleBulkCreate);
        bulkCreateBtn.dataset.bound = '1';
    }

    const bulkPasswordBtn = document.getElementById('bulkPasswordBtn');
    if (bulkPasswordBtn && !bulkPasswordBtn.dataset.bound) {
        bulkPasswordBtn.addEventListener('click', handleBulkPassword);
        bulkPasswordBtn.dataset.bound = '1';
    }

    const roomSearch = document.getElementById('roomSearch');
    if (roomSearch && !roomSearch.dataset.bound) {
        roomSearch.addEventListener('input', debounce(() => loadRooms(roomSearch.value.trim()), 300));
        roomSearch.dataset.bound = '1';
    }

    const roomsTbody = document.getElementById('roomsTbody');
    if (roomsTbody && !roomsTbody.dataset.bound) {
        roomsTbody.addEventListener('click', (e) => {
            const saveBtn = e.target.closest('.save-room-btn');
            const deleteBtn = e.target.closest('.delete-room-btn');
            if (saveBtn) handleSaveRoom(saveBtn.dataset.id);
            if (deleteBtn) handleDeleteRoom(deleteBtn.dataset.id);
        });
        roomsTbody.dataset.bound = '1';
    }
}

async function loadRooms(search = '') {
    const loadingEl = document.getElementById('roomsLoading');
    const errorEl = document.getElementById('roomsError');
    const emptyEl = document.getElementById('roomsEmpty');
    const tableEl = document.getElementById('roomsTable');
    const tbodyEl = document.getElementById('roomsTbody');
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = 'none';

    try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        const res = await fetch(`/api/manager/rooms?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401 || res.status === 403) { clearManagerSession(); renderLogin(); return; }
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const rooms = data.rooms || [];

        if (rooms.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
        } else {
            if (tableEl) tableEl.style.display = 'table';
            if (tbodyEl) {
                tbodyEl.innerHTML = rooms.map(r => `
                    <tr data-id="${r.id}">
                        <td><strong>Room ${escapeHtml(r.room_number || '')}</strong></td>
                        <td><code>${escapeHtml(r.username)}</code></td>
                        <td>
                            <input type="text" class="room-pwd-input" data-id="${r.id}"
                                placeholder="New password (optional)"
                                style="max-width:180px; padding:6px 8px; border:1px solid var(--input-border); border-radius:6px; background:var(--input-bg); color:var(--text-primary);">
                        </td>
                        <td>
                            <div style="display:flex; gap:6px;">
                                <button class="save-room-btn btn-secondary" data-id="${r.id}" style="padding:6px 10px; font-size:0.8rem;">💾 Save</button>
                                <button class="delete-room-btn" data-id="${r.id}" style="padding:6px 10px; font-size:0.8rem; background:none; border:1px solid var(--brand-danger,#ef4444); color:var(--brand-danger,#ef4444); border-radius:6px; cursor:pointer;">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (err) {
        console.error('Load rooms error:', err);
        if (errorEl) errorEl.style.display = 'block';
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

async function handleBulkCreate() {
    const roomNumbers = document.getElementById('bulkRoomNumbers')?.value.trim();
    const password = document.getElementById('bulkRoomPassword')?.value.trim();
    const statusEl = document.getElementById('bulkCreateStatus');

    if (!roomNumbers || !password) {
        showBulkStatus(statusEl, 'error', 'Room numbers and password are required.');
        return;
    }

    const btn = document.getElementById('bulkCreateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

    try {
        const res = await fetch('/api/manager/rooms/bulk-create', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomNumbers, password })
        });
        const data = await res.json();
        if (!res.ok) {
            showBulkStatus(statusEl, 'error', data.error || 'Failed to create rooms.');
        } else {
            showBulkStatus(statusEl, 'success', data.message);
            document.getElementById('bulkRoomNumbers').value = '';
            loadRooms();
        }
    } catch (err) {
        showBulkStatus(statusEl, 'error', 'Network error. Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Create Room Accounts'; }
    }
}

async function handleBulkPassword() {
    const newPassword = document.getElementById('bulkNewPassword')?.value.trim();
    const statusEl = document.getElementById('bulkPasswordStatus');

    if (!newPassword) {
        showBulkStatus(statusEl, 'error', 'Please enter a new password.');
        return;
    }
    if (!confirm('Reset the password for ALL room accounts in this hotel?')) return;

    const btn = document.getElementById('bulkPasswordBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }

    try {
        const res = await fetch('/api/manager/rooms/bulk-password', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPassword })
        });
        const data = await res.json();
        if (!res.ok) {
            showBulkStatus(statusEl, 'error', data.error || 'Failed.');
        } else {
            showBulkStatus(statusEl, 'success', `Password reset for ${data.updated} room account(s).`);
            document.getElementById('bulkNewPassword').value = '';
        }
    } catch (err) {
        showBulkStatus(statusEl, 'error', 'Network error.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Reset All Passwords'; }
    }
}

async function handleSaveRoom(id) {
    const pwdInput = document.querySelector(`.room-pwd-input[data-id="${id}"]`);
    const password = pwdInput ? pwdInput.value.trim() : '';

    if (!password) { alert('Enter a new password to save.'); return; }

    try {
        const res = await fetch(`/api/manager/rooms/${id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Failed to update.'); return; }
        if (pwdInput) pwdInput.value = '';
        alert('Password updated.');
    } catch (err) {
        alert('Network error.');
    }
}

async function handleDeleteRoom(id) {
    if (!confirm('Delete this room account? Their pending orders will be cancelled.')) return;
    try {
        const res = await fetch(`/api/manager/rooms/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Failed to delete.'); return; }
        loadRooms();
    } catch (err) {
        alert('Network error.');
    }
}

function showBulkStatus(el, type, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = type === 'success' ? 'var(--bg-tertiary)' : '#fee2e2';
    el.style.color = type === 'success' ? 'var(--text-primary)' : '#991b1b';
    el.style.border = type === 'success' ? '1px solid var(--border-primary)' : '1px solid #f87171';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderUsersTable(users) {
    const table = document.getElementById('usersTable');
    const tbody = document.getElementById('usersTbody');
    const empty = document.getElementById('usersEmpty');

    if (!table || !tbody || !empty) return;

    if (!users || users.length === 0) {
        table.style.display = 'none';
        empty.style.display = 'block';
        tbody.innerHTML = '';
        return;
    }

    empty.style.display = 'none';
    table.style.display = 'table';
    tbody.innerHTML = users.map(user => {
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || '—';
        return `
            <tr>
                <td>${user.id}</td>
                <td>${fullName}</td>
                <td>${user.username}</td>
                <td><span class="pill">${user.role}</span></td>
                <td>
                    <button class="btn-secondary edit-user-btn" data-id="${user.id}" style="padding:8px 12px;">Edit</button>
                </td>
            </tr>
        `;
    }).join('');
}

function openEditModal(userId) {
    const modal = document.getElementById('editUserModal');
    if (!modal) return;

    const user = usersCache.find(u => u.id === userId);
    if (!user) return;

    editingUserId = userId;
    document.getElementById('editUserId').value = userId;
    document.getElementById('editFirstName').value = user.first_name || '';
    document.getElementById('editLastName').value = user.last_name || '';
    document.getElementById('editUsername').value = user.username || '';
    document.getElementById('editPassword').value = '';
    document.getElementById('editRole').value = user.role || 'employee';
    document.getElementById('editDepartment').value = user.department || '';

    // Show/hide department field based on role
    const departmentField = document.getElementById('departmentFieldContainer');
    const roleSelect = document.getElementById('editRole');
    
    if (roleSelect) {
        roleSelect.addEventListener('change', (e) => {
            if (e.target.value === 'employee' && departmentField) {
                departmentField.style.display = 'block';
            } else if (departmentField) {
                departmentField.style.display = 'none';
            }
        });
        
        // Initial display
        if (roleSelect.value === 'employee' && departmentField) {
            departmentField.style.display = 'block';
        } else if (departmentField) {
            departmentField.style.display = 'none';
        }
    }

    modal.style.display = 'flex';
}

function closeEditModal() {
    const modal = document.getElementById('editUserModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingUserId) return;

    const firstName = document.getElementById('editFirstName').value.trim();
    const lastName = document.getElementById('editLastName').value.trim();
    const username = document.getElementById('editUsername').value.trim();
    const password = document.getElementById('editPassword').value;
    const role = document.getElementById('editRole').value;
    const department = role === 'employee' ? document.getElementById('editDepartment').value : null;

    if (!firstName || !lastName || !username) {
        alert('First name, last name, and username are required.');
        return;
    }

    const payload = { firstName, lastName, username, role, department };
    if (password && password.trim()) {
        payload.password = password.trim();
    }

    try {
        const response = await fetch(`/api/manager/users/${editingUserId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            const message = data?.error || 'Failed to update user';
            alert(message);
            return;
        }

        closeEditModal();
        loadUsers();
    } catch (error) {
        console.error('Edit user error:', error);
        alert('Error updating user. Please try again.');
    }
}

function clearManagerSession() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
}

function setUsersState({ loading = false, error = false }) {
    const loader = document.getElementById('usersLoading');
    const errorDiv = document.getElementById('usersError');

    if (loader) loader.style.display = loading ? 'block' : 'none';
    if (errorDiv) errorDiv.style.display = error ? 'block' : 'none';
}

// Reports
function setDefaultReportDate(inputEl) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    inputEl.value = `${yyyy}-${mm}-${dd}`;
}

async function downloadDailyReport() {
    const reportDateInput = document.getElementById('reportDate');
    const status = document.getElementById('reportStatus');

    if (!reportDateInput) return;
    const date = reportDateInput.value;
    if (!date) {
        showReportError('Please pick a date to export.');
        return;
    }

    showReportError('', false);
    try {
        const params = new URLSearchParams({ date });
        const response = await fetch(`/api/manager/reports/daily?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401 || response.status === 403) {
            clearManagerSession();
            renderLogin();
            return;
        }

        const data = await response.json();
        if (!response.ok) {
            const message = data?.error || 'Failed to fetch report.';
            showReportError(message);
            return;
        }

        const rows = (data.orders || []).map((o) => {
            const durationMinutes = typeof o.duration_minutes === 'number' ? o.duration_minutes : '';
            const statusText = o.status || '';
            return {
                Department: o.department,
                OrderID: o.id,
                Name: o.order_name,
                Notes: o.order_notes,
                Status: statusText,
                OnHold: o.on_hold ? 'Yes' : 'No',
                HoldInfo: o.hold_info || '',
                HoldUntil: o.hold_until || '',
                HoldReason: o.hold_reason || '',
                CreatedAt: o.created_at,
                CompletedAt: o.completed_at || '',
                DurationMinutes: durationMinutes,
                Creator: o.creatorName || '',
                CreatorUsername: o.creatorUsername || '',
                Receiver: o.receiverName || '',
                ReceiverUsername: o.receiverUsername || '',
                HotelCode: o.hotel_code || ''
            };
        });

        if (!rows.length) {
            showReportError('No orders found for that date.');
            return;
        }

        exportToCsv(`roomaid-daily-report-${date}.csv`, rows);
    } catch (error) {
        console.error('Report export error:', error);
        showReportError('Error exporting report. Please try again.');
    }
}

function showReportError(message, show = true) {
    const status = document.getElementById('reportStatus');
    if (!status) return;
    if (show && message) {
        status.textContent = message;
        status.style.display = 'block';
        status.className = 'alert alert-error';
    } else {
        status.textContent = '';
        status.style.display = 'none';
    }
}

function exportToCsv(filename, rows) {
    if (!rows || !rows.length) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [headers.join(',')]
        .concat(rows.map(row => headers.map(h => csvEscape(row[h])).join(',')))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Navigation
function goToMainDashboard() {
    window.location.href = 'index.html';
}

// Theme helpers
function setupThemeToggle() {
    if (!themeToggle) return;
    themeToggle.addEventListener('click', toggleDarkMode);
    updateThemeToggleIcon();
}

function initializeDarkMode() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
}

function toggleDarkMode() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeToggleIcon();

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f5f5f5');
    }
}

function autoDetectTheme() {
    if (!localStorage.getItem('theme')) {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        setTheme(prefersDark ? 'dark' : 'light');
    }
}

function updateThemeToggleIcon() {
    if (!themeToggle) return;
    const current = document.documentElement.getAttribute('data-theme');
    themeToggle.textContent = current === 'dark' ? '🌙' : '☀️';
    themeToggle.title = current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

// Utils
function debounce(fn, delay) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
    };
}
