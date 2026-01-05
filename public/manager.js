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
    window.addEventListener('beforeunload', clearManagerSession);
});

function bootstrapSession() {
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');

    if (savedToken && savedUser) {
        authToken = savedToken;
        currentUser = JSON.parse(savedUser);
        renderDashboard();
        loadUsers();
    } else {
        renderLogin();
    }
}

// UI: Login
function renderLogin() {
    if (!root) return;

    root.innerHTML = `
        <div class="screen">
            <div class="login-container" style="width:100%;max-width:420px;">
                <div class="logo-container" style="margin-bottom: 0.5rem;">
                    <h2 style="text-align:center;">Manager Login</h2>
                    <p style="text-align:center;color:var(--text-secondary);">Access your hotel's team</p>
                </div>
                <form id="managerLoginForm">
                    <div class="form-group">
                        <label for="managerUsername">Username</label>
                        <input type="text" id="managerUsername" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="managerPassword">Password</label>
                        <input type="password" id="managerPassword" name="password" required>
                    </div>
                    <div class="form-group">
                        <label for="managerHotelCode">Hotel Code</label>
                        <input type="text" id="managerHotelCode" name="hotelCode" required placeholder="HOTEL001">
                    </div>
                    <button class="btn-primary" type="submit" style="width:100%;">Login</button>
                    <div id="managerLoginError" class="alert alert-error" style="margin-top:12px; display:none;"></div>
                </form>
            </div>
        </div>
    `;

    const form = document.getElementById('managerLoginForm');
    if (form) {
        form.addEventListener('submit', handleManagerLogin);
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
                    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
                        <div class="form-group" style="margin:0;">
                            <label for="reportDate" style="margin-bottom:6px; display:block;">Date</label>
                            <input type="date" id="reportDate" style="min-width:180px;">
                        </div>
                        <button id="downloadReportBtn" class="btn-primary" style="height:44px;">Download Excel (CSV)</button>
                    </div>
                </div>
                <div id="reportStatus" class="alert alert-error" style="display:none; margin-top:12px;"></div>
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
}

function switchTab(tab) {
    currentTab = tab;
    const tabs = ['users', 'reports'];
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

    if (!firstName || !lastName || !username) {
        alert('First name, last name, and username are required.');
        return;
    }

    const payload = { firstName, lastName, username, role };
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
