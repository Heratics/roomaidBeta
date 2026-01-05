// Manager Dashboard Script
let authToken = null;
let currentUser = null;
let currentTab = 'users';
let usersCache = [];

const root = document.getElementById('manager-root');
const themeToggle = document.getElementById('themeToggle');

// Boot
document.addEventListener('DOMContentLoaded', () => {
    initializeDarkMode();
    autoDetectTheme();
    setupThemeToggle();
    bootstrapSession();
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
            <button id="logoutBtn" class="settings-btn">Logout</button>
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
                        </tr>
                    </thead>
                    <tbody id="usersTbody"></tbody>
                </table>
            </div>
        </div>
        <div id="reports-section" class="manager-section">
            <div class="placeholder-card">
                <h3 style="margin-bottom:8px;">Reports</h3>
                <p>Reports for your hotel will appear here. Coming soon.</p>
            </div>
        </div>
    `;

    attachDashboardEvents();
}

function attachDashboardEvents() {
    document.getElementById('usersTab')?.addEventListener('click', () => switchTab('users'));
    document.getElementById('reportsTab')?.addEventListener('click', () => switchTab('reports'));
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

    const searchInput = document.getElementById('userSearch');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            loadUsers(searchInput.value.trim());
        }, 300));
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
            await handleLogout(true);
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
            </tr>
        `;
    }).join('');
}

function setUsersState({ loading = false, error = false }) {
    const loader = document.getElementById('usersLoading');
    const errorDiv = document.getElementById('usersError');

    if (loader) loader.style.display = loading ? 'block' : 'none';
    if (errorDiv) errorDiv.style.display = error ? 'block' : 'none';
}

// Logout
async function handleLogout(silent = false) {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }

    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');

    if (!silent) {
        renderLogin();
    }
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
