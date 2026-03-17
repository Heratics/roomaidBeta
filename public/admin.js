/**
 * RoomAid Admin Panel JavaScript
 * Handles user management, authentication, and admin functionality
 */

// Global variables
let currentUser = null;
let authToken = null;
let isLoading = false;
let lastRequestTime = 0;
const REQUEST_THROTTLE = 500; // Minimum 500ms between requests (reduced from 1000ms)
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 0; // Disabled - users must manually refresh

// Pagination variables
let currentPage = 1;
let pageSize = 25;
let totalUsers = 0;
let totalPages = 0;

// Settings menu state
let settingsMenuOpen = false;

// Initialize admin panel when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initialize dark mode
    initializeDarkMode();
    
    // Set up form handlers
    setupFormHandlers();
    
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
    
    // Check if user has an active session (like main app)
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
        authToken = savedToken;
        currentUser = JSON.parse(savedUser);
        
        // Check if user is admin
        console.log('Current user from session:', currentUser);
        console.log('User role:', currentUser.role);
        
        if (currentUser.role === 'admin') {
            console.log('Admin authenticated from session:', currentUser);
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                loadUsers();
                loadHotels();
                // Auto-refresh disabled - users must manually click refresh button
            }, 100);
        } else {
            showAlert('Access denied. Admin privileges required.', 'error');
            showLoginForm();
        }
    } else {
        // User not logged in, show login form
        showLoginForm();
    }
    
});

/**
 * Throttle requests to prevent rate limiting
 */
function throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < REQUEST_THROTTLE) {
        return false; // Request too soon
    }
    
    lastRequestTime = now;
    return true;
}

/**
 * Verify current session with server (optional verification)
 */
async function verifySession() {
    if (!authToken) return false;
    
    try {
        const response = await fetch('/api/auth/verify', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            if (response.status === 429) {
                showAlert('Rate limit exceeded. Please wait a moment and try again.', 'error');
                return false;
            }
            return false;
        }
        
        const data = await response.json();
        currentUser = data.user;
        
        // Update persistent storage with fresh user data
        localStorage.setItem('user', JSON.stringify(currentUser));
        
        return currentUser.role === 'admin';
    } catch (error) {
        console.error('Session verification error:', error);
        return false;
    }
}

/**
 * Show login form on the admin page
 */
function showLoginForm() {
    // Create login form HTML
    const loginHTML = `
        <div id="admin-login" style="max-width: 500px; margin: 50px auto; padding: 40px; background: var(--bg-secondary); border-radius: 16px; box-shadow: 0 10px 25px var(--shadow-primary); border: 1px solid var(--border-primary);">
            <h2 style="text-align: center; margin-bottom: 30px; color: var(--text-primary); font-size: 1.8rem; font-weight: 600;">🔐 Admin Login</h2>
            <form id="admin-login-form">
                <div class="form-group">
                    <label for="admin-username" style="color: var(--text-primary); font-weight: bold; margin-bottom: 8px; display: block;">Username:</label>
                    <input type="text" id="admin-username" name="username" required style="width: 100%; padding: 12px; border: 2px solid var(--input-border); border-radius: 8px; background: var(--input-bg); color: var(--text-primary); font-size: 16px; box-sizing: border-box;">
                </div>
                
                <div class="form-group">
                    <label for="admin-password" style="color: var(--text-primary); font-weight: bold; margin-bottom: 8px; display: block;">Password:</label>
                    <input type="password" id="admin-password" name="password" required style="width: 100%; padding: 12px; border: 2px solid var(--input-border); border-radius: 8px; background: var(--input-bg); color: var(--text-primary); font-size: 16px; box-sizing: border-box;">
                </div>
                
                <button type="submit" class="btn-primary" style="width: 100%; padding: 14px 28px; background: var(--brand-secondary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px; transition: all 0.3s ease;">Login as Admin</button>
            </form>
        </div>
    `;
    
    // Hide admin content and show login form
    document.querySelector('.admin-container').innerHTML = loginHTML;
    
    // Set up login form handler
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
}

/**
 * Hide login form and show admin content
 */
function hideLoginForm() {
    // Remove login form and restore admin content
    const loginDiv = document.getElementById('admin-login');
    if (loginDiv) {
        loginDiv.remove();
    }
    
    // Restore the original admin container content
    const adminContainer = document.querySelector('.admin-container');
    if (adminContainer) {
        adminContainer.innerHTML = `
            <div class="admin-header">
                <h1>🏨 RoomAid Admin Panel</h1>
                <p>User Management & System Administration</p>
                <div class="header-settings">
                    <div class="settings-menu">
                        <button id="settingsBtn" class="settings-btn" title="Settings" onclick="toggleSettingsMenu()">
                            <span class="settings-btn-icon">⚙️</span>
                        </button>
                        <div id="settingsDropdown" class="settings-dropdown">
                            <button class="settings-item" onclick="toggleDarkMode()">
                                <span class="settings-item-icon" id="themeIcon">🌙</span>
                                <span id="themeText">Dark Mode</span>
                            </button>
                            <button class="settings-item danger" onclick="logout()">
                                <span class="settings-item-icon">🚪</span>
                                <span>Logout</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="admin-nav">
                <button class="nav-btn active" onclick="showSection('users')">👥 Manage Users</button>
                <button class="nav-btn" onclick="showSection('hotels')">🏨 Manage Hotels</button>
                    <button class="nav-btn" onclick="goToDashboard()">⬅️ Back to Dashboard</button>
            </div>
            
            <!-- Alert Messages -->
            <div id="alert" class="alert"></div>
            
            <!-- User Management Section -->
            <div id="users-section" class="admin-section active">
                <h2>👥 User Management</h2>
                
                <!-- Add User Form -->
                <div style="background: var(--bg-tertiary); padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid var(--border-primary);">
                    <h3>Add New User</h3>
                    <form id="add-user-form">
                        <div class="form-group">
                            <label for="firstName">First Name:</label>
                            <input type="text" id="firstName" name="firstName" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="lastName">Last Name:</label>
                            <input type="text" id="lastName" name="lastName" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="username">Username:</label>
                            <input type="text" id="username" name="username" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="password">Password:</label>
                            <input type="password" id="password" name="password" required>
                        </div>
                        
                        <div id="hotelCodeFieldAdd" class="form-group">
                            <label for="hotelCode">Hotel Code:</label>
                            <select id="hotelCode" name="hotelCode" required>
                                <option value="">Select Hotel</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="role">Role:</label>
                            <select id="role" name="role" required>
                                <option value="employee">Employee</option>
                                <option value="supervisor">Supervisor</option>
                                <option value="manager">Manager</option>
                                <option value="front_desk">Front Desk</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        
                        <button type="submit" class="btn-primary">Add User</button>
                    </form>
                </div>
                
                <!-- Users List -->
                <div>
                    <h3>Current Users</h3>
                    <div id="users-loading" class="loading">Loading users...</div>
                    <table id="users-table" class="users-table" style="display: none;">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Username</th>
                                <th>Hotel</th>
                                <th>Role</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="users-tbody">
                        </tbody>
                    </table>
                </div>
            </div>
            
            <!-- Hotels Management Section -->
            <div id="hotels-section" class="admin-section">
                <h2>🏨 Hotel Management</h2>
                
                <!-- Add Hotel Form -->
                <div style="background: var(--bg-tertiary); padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid var(--border-primary);">
                    <h3>Add New Hotel</h3>
                    <form id="add-hotel-form">
                        <div class="form-group">
                            <label for="hotelName">Hotel Name:</label>
                            <input type="text" id="hotelName" name="hotelName" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="hotelCode">Hotel Code:</label>
                            <input type="text" id="hotelCode" name="hotelCode" required placeholder="e.g., HOTEL001">
                        </div>
                        
                        <button type="submit" class="btn-primary">Add Hotel</button>
                    </form>
                </div>
                
                <!-- Hotels List -->
                <div>
                    <h3>Current Hotels</h3>
                    <div id="hotels-loading" class="loading">Loading hotels...</div>
                    <table id="hotels-table" class="users-table" style="display: none;">
                        <thead>
                            <tr>
                                <th style="text-align: left;">Hotel Name</th>
                                <th style="text-align: center;">Hotel Code</th>
                                <th style="text-align: center;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="hotels-tbody">
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        // Re-setup form handlers
        setupFormHandlers();
        
        // Re-initialize dark mode to update the settings menu
        initializeDarkMode();
    }
}

/**
 * Handle admin login form submission
 */
async function handleAdminLogin(event) {
    event.preventDefault();
    
    // Throttle requests
    if (!throttleRequest()) {
        showAlert('Please wait before making another request', 'error');
        return;
    }
    
    const formData = new FormData(event.target);
    const loginData = {
        username: formData.get('username'),
        password: formData.get('password')
    };
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // Store token persistently for week-long sessions
            authToken = result.token;
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('user', JSON.stringify(result.user));
            
            // Check if user is admin
            if (result.user.role !== 'admin') {
                showAlert('Access denied. Admin privileges required. Please update your role in the database.', 'error');
                return;
            }
            
            currentUser = result.user;
            showAlert('Login successful! Loading admin panel...', 'success');
            
            // Hide login form and show admin content without page reload
            setTimeout(() => {
                hideLoginForm();
                // Load data after showing admin content
                setTimeout(() => {
                    loadUsers();
                    loadHotels();
                    // Auto-refresh disabled - users must click refresh button
                }, 100);
            }, 1000);
            
        } else {
            if (response.status === 429) {
                showAlert('Rate limit exceeded. Please wait a moment and try again.', 'error');
            } else {
                showAlert(result.error || 'Login failed', 'error');
            }
        }
        
    } catch (error) {
        console.error('Login error:', error);
        showAlert('Login error. Please try again.', 'error');
    }
}

/**
 * Check if user is authenticated and has admin privileges
 */
async function checkAuth() {
    try {
        // Get token from localStorage or session
        authToken = localStorage.getItem('authToken');
        
        if (!authToken) {
            // Redirect to login if no token
            window.location.href = '/login.html';
            return;
        }
        
        // Verify token and check if user is admin
        const response = await fetch('/api/auth/verify', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Authentication failed');
        }
        
        const data = await response.json();
        currentUser = data.user;
        
        if (currentUser.role !== 'admin') {
            showAlert('Access denied. Admin privileges required.', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
            return;
        }
        
        console.log('Admin authenticated:', currentUser);
        
    } catch (error) {
        console.error('Authentication error:', error);
        showAlert('Authentication failed. Redirecting to login...', 'error');
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 2000);
    }
}

/**
 * Set up form event handlers
 */
function setupFormHandlers() {
    // Add user form
    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
        addUserForm.addEventListener('submit', handleAddUser);
    }
    
    // Add role change listener to show/hide department field and hotel code field
    const roleSelect = document.getElementById('role');
    const departmentFieldAdd = document.getElementById('departmentFieldAdd');
    const hotelCodeFieldAdd = document.getElementById('hotelCodeFieldAdd');
    if (roleSelect) {
        // Set initial state
        if (roleSelect.value === 'employee') {
            if (departmentFieldAdd) departmentFieldAdd.style.display = 'block';
            if (hotelCodeFieldAdd) hotelCodeFieldAdd.style.display = 'block';
        } else if (roleSelect.value === 'admin') {
            if (departmentFieldAdd) departmentFieldAdd.style.display = 'none';
            if (hotelCodeFieldAdd) hotelCodeFieldAdd.style.display = 'none';
        } else {
            if (departmentFieldAdd) departmentFieldAdd.style.display = 'none';
            if (hotelCodeFieldAdd) hotelCodeFieldAdd.style.display = 'block';
        }
        
        // Listen for changes
        roleSelect.addEventListener('change', function() {
            if (this.value === 'employee') {
                if (departmentFieldAdd) departmentFieldAdd.style.display = 'block';
                if (hotelCodeFieldAdd) hotelCodeFieldAdd.style.display = 'block';
            } else if (this.value === 'admin') {
                if (departmentFieldAdd) departmentFieldAdd.style.display = 'none';
                if (hotelCodeFieldAdd) hotelCodeFieldAdd.style.display = 'none';
                // Clear department and hotel selections when role is admin
                const departmentSelect = document.getElementById('department');
                const hotelSelect = document.getElementById('hotelCode');
                if (departmentSelect) departmentSelect.value = '';
                if (hotelSelect) hotelSelect.value = '';
            } else {
                if (departmentFieldAdd) departmentFieldAdd.style.display = 'none';
                if (hotelCodeFieldAdd) hotelCodeFieldAdd.style.display = 'block';
                // Clear department selection
                const departmentSelect = document.getElementById('department');
                if (departmentSelect) departmentSelect.value = '';
            }
        });
    }

    // Add hotel change listener to filter department options
    const hotelCodeSelect = document.getElementById('hotelCode');
    const departmentSelect = document.getElementById('department');
    if (hotelCodeSelect && departmentSelect) {
        hotelCodeSelect.addEventListener('change', async function() {
            const hotelCode = this.value;
            if (!hotelCode) {
                // Reset to all departments if no hotel selected
                updateDepartmentOptions(departmentSelect, ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk']);
                return;
            }

            try {
                const response = await fetch(`/api/hotels/${hotelCode}/departments`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
                });

                if (response.ok) {
                    const result = await response.json();
                    updateDepartmentOptions(departmentSelect, result.departments);
                } else {
                    // Fallback to all departments
                    updateDepartmentOptions(departmentSelect, ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk']);
                }
            } catch (error) {
                console.error('Error loading hotel departments:', error);
                updateDepartmentOptions(departmentSelect, ['Engineering', 'Housekeeping', 'Laundry', 'Room Service', 'Front Desk']);
            }
        });
    }
    
    // Edit user form
    const editUserForm = document.getElementById('editUserForm');
    if (editUserForm) {
        editUserForm.addEventListener('submit', handleEditUserSubmit);
    }

    // Add role change listener for edit modal
    const editRoleSelect = document.getElementById('editRole');
    const editDepartmentField = document.getElementById('editDepartmentField');
    if (editRoleSelect && editDepartmentField) {
        editRoleSelect.addEventListener('change', function() {
            if (this.value === 'employee') {
                editDepartmentField.style.display = 'flex';
            } else {
                editDepartmentField.style.display = 'none';
                const editDepartment = document.getElementById('editDepartment');
                if (editDepartment) editDepartment.value = '';
            }
        });
    }
    
    // Add hotel form
    const addHotelForm = document.getElementById('add-hotel-form');
    if (addHotelForm) {
        addHotelForm.addEventListener('submit', handleAddHotel);
    }

    // Edit hotel form
    const editHotelForm = document.getElementById('editHotelForm');
    if (editHotelForm) {
        editHotelForm.addEventListener('submit', handleEditHotel);
    }
}

/**
 * Handle add user form submission
 */
async function handleAddUser(event) {
    event.preventDefault();
    
    // Throttle requests
    if (!throttleRequest()) {
        showAlert('Please wait before making another request', 'error');
        return;
    }
    
    const formData = new FormData(event.target);
    const role = formData.get('role');
    const department = role === 'employee' ? formData.get('department') : null;
    
    // Hotel code is not required for admin users
    const hotelCode = role === 'admin' ? null : formData.get('hotelCode');
    
    const userData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        username: formData.get('username'),
        password: formData.get('password'),
        hotelCode: hotelCode,
        role: role,
        department: department
    };
    
    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('User created successfully!', 'success');
            event.target.reset();
            // Hide department field after reset
            const departmentFieldAdd = document.getElementById('departmentFieldAdd');
            if (departmentFieldAdd) departmentFieldAdd.style.display = 'none';
            loadUsers(); // Refresh users list
        } else {
            showAlert(result.error || 'Failed to create user', 'error');
        }
        
    } catch (error) {
        console.error('Error creating user:', error);
        showAlert('Error creating user. Please try again.', 'error');
    }
}

/**
 * Load and display users with enhanced error handling, loading states, and pagination
 */
async function loadUsers(searchTerm = '', refresh = false, page = 1) {
    if (isLoading && !refresh) return; // Prevent multiple simultaneous calls unless refreshing
    
    try {
        isLoading = true;
        console.log('Loading users with token:', authToken ? 'present' : 'missing');
        
        // Show loading state
        showUserLoadingState(true);
        
        // Build URL with pagination and search parameters
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        params.append('page', page);
        params.append('limit', pageSize);
        
        const url = `/api/admin/users?${params.toString()}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Users response status:', response.status);
        
        if (!response.ok) {
            if (response.status === 429) {
                showAlert('Rate limit exceeded. Please wait a moment and try again.', 'error');
                setTimeout(() => loadUsers(searchTerm, false, page), 5000); // Retry after 5 seconds
                return;
            } else if (response.status === 401) {
                showAlert('Session expired. Please login again.', 'error');
                setTimeout(() => {
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('user');
                    window.location.href = '/login.html';
                }, 2000);
                return;
            } else if (response.status === 403) {
                showAlert('Access denied. Admin privileges required.', 'error');
                return;
            }
            const errorText = await response.text();
            console.error('Users API error:', response.status, errorText);
            throw new Error(`Failed to load users: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Users data received:', data);
        
        // Update pagination variables
        currentPage = data.currentPage || 1;
        pageSize = data.pageSize || 25;
        totalUsers = data.totalCount || 0;
        totalPages = data.totalPages || 1;
        
        // Store users globally for search/filtering
        window.allUsers = data.users || [];
        
        // Update search input if it exists
        const searchInput = document.getElementById('user-search');
        if (searchInput && searchTerm) {
            searchInput.value = searchTerm;
        }
        
        displayUsers(data.users, searchTerm);
        updatePaginationControls();
        
        // Show success message if refreshing
        if (refresh) {
            showAlert('Users refreshed successfully!', 'success');
        }
        
    } catch (error) {
        console.error('Error loading users:', error);
        showAlert('Error loading users. Please try again.', 'error');
        displayUserError();
    } finally {
        isLoading = false;
        showUserLoadingState(false);
    }
}

/**
 * Show/hide user loading state
 */
function showUserLoadingState(show) {
    const loadingDiv = document.getElementById('users-loading');
    const table = document.getElementById('users-table');
    const errorDiv = document.getElementById('users-error');
    
    if (show) {
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (table) table.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';
    } else {
        if (loadingDiv) loadingDiv.style.display = 'none';
    }
}

/**
 * Display user error state
 */
function displayUserError() {
    const loadingDiv = document.getElementById('users-loading');
    const table = document.getElementById('users-table');
    const tbody = document.getElementById('users-tbody');
    
    // Hide loading, show table
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (table) table.style.display = 'table';
    
    // Clear existing rows and show error
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--brand-danger); padding: 20px;">
                    <div style="font-size: 18px; margin-bottom: 10px;">⚠️</div>
                    <div>Failed to load users. Please try again.</div>
                    <button onclick="loadUsers()" style="margin-top: 10px; padding: 8px 16px; background: var(--brand-secondary); color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Retry
                    </button>
                </td>
            </tr>
        `;
    }
}

/**
 * Display users in the table with enhanced information
 */
function displayUsers(users, searchTerm = '') {
    const loadingDiv = document.getElementById('users-loading');
    const table = document.getElementById('users-table');
    const tbody = document.getElementById('users-tbody');
    
    // Hide loading, show table
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (table) table.style.display = 'table';
    
    // Clear existing rows
    if (tbody) tbody.innerHTML = '';
    
    if (!users || users.length === 0) {
        const noUsersMessage = searchTerm ? 
            `No users found matching "${searchTerm}"` : 
            'No users found';
        
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 20px;">
                        <div style="font-size: 18px; margin-bottom: 10px;">👥</div>
                        <div>${noUsersMessage}</div>
                        ${searchTerm ? `<button onclick="clearUserSearch()" style="margin-top: 10px; padding: 8px 16px; background: var(--brand-secondary); color: white; border: none; border-radius: 4px; cursor: pointer;">Clear Search</button>` : ''}
                    </td>
                </tr>
            `;
        }
        return;
    }
    
    // Add user rows with enhanced information
    users.forEach(user => {
        const row = document.createElement('tr');
        const fullName = user.first_name && user.last_name ? 
            `${user.first_name} ${user.last_name}` : 
            (user.username || 'N/A');
        
        const roleBadge = getRoleBadge(user.role);
        
        row.innerHTML = `
            <td>${user.id}</td>
            <td>
                <div style="font-weight: 600;">${escapeHtml(fullName)}</div>
            </td>
            <td>
                <div style="font-weight: 500;">${escapeHtml(user.username)}</div>
            </td>
            <td>
                <div style="font-weight: 500;">${escapeHtml(user.hotelName || user.hotel_code)}</div>
            </td>
            <td>${roleBadge}</td>
            <td>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn-danger" onclick="deleteUser(${user.id})" style="font-size: 12px; padding: 6px 12px;">Delete</button>
                    <button onclick="editUser(${user.id})" style="font-size: 12px; padding: 6px 12px; background: var(--brand-primary); color: white; border: none; border-radius: 4px; cursor: pointer;">Edit</button>
                </div>
            </td>
        `;
        if (tbody) tbody.appendChild(row);
    });
}

/**
 * Get role badge HTML
 */
function getRoleBadge(role) {
    const roleColors = {
        'admin': 'background: var(--brand-danger); color: white;',
        'manager': 'background: var(--brand-primary); color: white;',
        'employee': 'background: var(--brand-secondary); color: white;'
    };
    
    const color = roleColors[role] || 'background: var(--text-secondary); color: white;';
    
    return `<span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; ${color}">${role}</span>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Clear user search
 */
function clearUserSearch() {
    const searchInput = document.getElementById('user-search');
    if (searchInput) {
        searchInput.value = '';
    }
    loadUsers();
}

/**
 * Search users
 */
function searchUsers() {
    const searchInput = document.getElementById('user-search');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    loadUsers(searchTerm);
}

/**
 * Refresh users
 */
function refreshUsers() {
    loadUsers('', true, currentPage);
}

/**
 * Change page
 */
function changePage(direction) {
    const newPage = currentPage + direction;
    if (newPage >= 1 && newPage <= totalPages) {
        const searchInput = document.getElementById('user-search');
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        loadUsers(searchTerm, false, newPage);
    }
}

/**
 * Change page size
 */
function changePageSize() {
    const pageSizeSelect = document.getElementById('page-size');
    if (pageSizeSelect) {
        pageSize = parseInt(pageSizeSelect.value);
        currentPage = 1; // Reset to first page
        const searchInput = document.getElementById('user-search');
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        loadUsers(searchTerm, false, 1);
    }
}

/**
 * Update pagination controls
 */
function updatePaginationControls() {
    const paginationDiv = document.getElementById('users-pagination');
    const prevButton = document.getElementById('prev-page');
    const nextButton = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    const pageSizeSelect = document.getElementById('page-size');
    
    if (!paginationDiv || !prevButton || !nextButton || !pageInfo) return;
    
    // Show pagination if there are multiple pages
    if (totalPages > 1) {
        paginationDiv.style.display = 'flex';
        
        // Update button states
        prevButton.disabled = currentPage <= 1;
        nextButton.disabled = currentPage >= totalPages;
        
        // Update page info
        const startUser = (currentPage - 1) * pageSize + 1;
        const endUser = Math.min(currentPage * pageSize, totalUsers);
        pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${startUser}-${endUser} of ${totalUsers})`;
        
        // Update page size select
        if (pageSizeSelect) {
            pageSizeSelect.value = pageSize;
        }
    } else {
        paginationDiv.style.display = 'none';
    }
}

/**
 * Edit user (placeholder for future implementation)
 */
function editUser(userId) {
    // Find the user in the current users list
    const user = allUsers.find(u => u.id === userId);
    if (!user) {
        showAlert('User not found', 'error');
        return;
    }
    
    // Populate the edit form
    document.getElementById('editUserId').value = userId;
    document.getElementById('editFirstName').value = user.first_name || '';
    document.getElementById('editLastName').value = user.last_name || '';
    document.getElementById('editUsername').value = user.username || '';
    document.getElementById('editRole').value = user.role || 'employee';
    document.getElementById('editPassword').value = '';
    
    // Handle department field
    const editDepartmentField = document.getElementById('editDepartmentField');
    const editDepartment = document.getElementById('editDepartment');
    
    if (user.role === 'employee') {
        if (editDepartmentField) editDepartmentField.style.display = 'flex';
        
        // Load hotel departments for filtering and set current department
        if (user.hotel_code) {
            loadHotelDepartmentsForEdit(user.hotel_code, user.department);
        } else {
            // Fallback if no hotel code
            if (editDepartment) editDepartment.value = user.department || '';
        }
    } else {
        if (editDepartmentField) editDepartmentField.style.display = 'none';
        if (editDepartment) editDepartment.value = '';
    }
    
    // Show the modal
    document.getElementById('editUserModal').style.display = 'flex';
}

function closeEditUserModal() {
    document.getElementById('editUserModal').style.display = 'none';
}

async function handleEditUserSubmit(event) {
    event.preventDefault();
    
    const userId = document.getElementById('editUserId').value;
    const firstName = document.getElementById('editFirstName').value;
    const lastName = document.getElementById('editLastName').value;
    const username = document.getElementById('editUsername').value;
    const password = document.getElementById('editPassword').value;
    const role = document.getElementById('editRole').value;
    const department = document.getElementById('editDepartment').value;
    
    if (!firstName || !lastName || !username) {
        showAlert('First name, last name, and username are required', 'error');
        return;
    }
    
    try {
        const updateData = {
            firstName,
            lastName,
            username,
            role
        };
        
        // Only include password if it was provided
        if (password) {
            updateData.password = password;
        }
        
        // Include department if role is employee
        if (role === 'employee') {
            updateData.department = department || null;
        }
        
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('User updated successfully!', 'success');
            closeEditUserModal();
            loadUsers(); // Refresh users list
        } else {
            showAlert(result.error || 'Failed to update user', 'error');
        }
    } catch (error) {
        console.error('Error updating user:', error);
        showAlert('Error updating user', 'error');
    }
}

/**
 * Delete a user
 */
let userToDelete = null;

async function deleteUser(userId) {
    // First, check if user has orders
    try {
        const response = await fetch(`/api/admin/users/${userId}/check-orders`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.hasOrders) {
            // User has orders, show override modal
            userToDelete = userId;
            showDeleteUserModal(result.ordersCreated, result.ordersAssigned);
        } else {
            // No orders, proceed with simple confirmation
            if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
                performDeleteUser(userId, false);
            }
        }
    } catch (error) {
        console.error('Error checking user orders:', error);
        // Fallback to simple delete
        if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
            performDeleteUser(userId, false);
        }
    }
}

function showDeleteUserModal(ordersCreated, ordersAssigned) {
    const modal = document.getElementById('deleteUserModal');
    const message = document.getElementById('deleteUserMessage');
    
    if (modal && message) {
        message.innerHTML = `This user has <strong>${ordersCreated}</strong> order(s) created and <strong>${ordersAssigned}</strong> order(s) assigned.<br><br>Are you sure you want to delete this user?`;
        modal.style.display = 'flex';
    }
}

function closeDeleteUserModal() {
    const modal = document.getElementById('deleteUserModal');
    if (modal) {
        modal.style.display = 'none';
    }
    userToDelete = null;
}

function confirmDeleteUserOverride() {
    if (userToDelete) {
        performDeleteUser(userToDelete, true);
        closeDeleteUserModal();
    }
}

async function performDeleteUser(userId, override) {
    // Throttle requests
    if (!throttleRequest()) {
        showAlert('Please wait before making another request', 'error');
        return;
    }
    
    try {
        const url = override 
            ? `/api/admin/users/${userId}?override=true`
            : `/api/admin/users/${userId}`;
            
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('User deleted successfully!', 'success');
            loadUsers(); // Refresh users list
        } else {
            showAlert(result.error || 'Failed to delete user', 'error');
        }
        
    } catch (error) {
        console.error('Error deleting user:', error);
        showAlert('Error deleting user. Please try again.', 'error');
    }
}

/**
 * Start auto-refresh for users
 * DISABLED - Users must use manual refresh button
 */
function startAutoRefresh() {
    // Auto-refresh disabled. Users can click the refresh button to manually update the list.
    console.log('Auto-refresh disabled. Click the refresh button to update.');
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

/**
 * Show section based on navigation
 */
function showSection(sectionName) {
    // Hide all sections
    const sections = document.querySelectorAll('.admin-section');
    sections.forEach(section => section.classList.remove('active'));
    
    // Remove active class from all nav buttons
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => btn.classList.remove('active'));
    
    // Show selected section
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    // Add active class to clicked button
    event.target.classList.add('active');
    
    // Load data for specific sections
    if (sectionName === 'users') {
        loadUsers();
    } else if (sectionName === 'hotels') {
        loadHotels();
    }
}

/**
 * Handle add hotel form submission
 */
async function handleAddHotel(event) {
    event.preventDefault();
    
    // Throttle requests
    if (!throttleRequest()) {
        showAlert('Please wait before making another request', 'error');
        return;
    }
    
    const formData = new FormData(event.target);
    
    // Get selected departments
    const departments = [];
    const deptCheckboxes = event.target.querySelectorAll('input[name="department"]:checked');
    deptCheckboxes.forEach(cb => departments.push(cb.value));
    
    if (departments.length === 0) {
        showAlert('Please select at least one department', 'error');
        return;
    }
    
    const hotelData = {
        name: formData.get('hotelName'),
        code: formData.get('hotelCode'),
        departments: departments
    };
    
    try {
        const response = await fetch('/api/admin/hotels', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(hotelData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Hotel added successfully!', 'success');
            event.target.reset();
            // Re-check all checkboxes for next hotel
            event.target.querySelectorAll('input[name="department"]').forEach(cb => cb.checked = true);
            loadHotels(); // Reload hotels list
        } else {
            showAlert(result.error || 'Failed to add hotel', 'error');
        }
    } catch (error) {
        console.error('Error adding hotel:', error);
        showAlert('Error adding hotel. Please try again.', 'error');
    }
}

/**
 * Load and display hotels
 */
async function loadHotels() {
    if (isLoading) return;
    
    // Throttle requests
    if (!throttleRequest()) {
        console.log('Load hotels request throttled, waiting...');
        setTimeout(() => loadHotels(), REQUEST_THROTTLE);
        return;
    }
    
    try {
        isLoading = true;
        console.log('Loading hotels with token:', authToken ? 'present' : 'missing');
        
        const response = await fetch('/api/admin/hotels', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Hotels response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Hotels API error:', response.status, errorText);
            throw new Error(`Failed to load hotels: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Hotels data received:', data);
        displayHotels(data.hotels);
        
    } catch (error) {
        console.error('Error loading hotels:', error);
        showAlert('Error loading hotels. Please try again.', 'error');
    } finally {
        isLoading = false;
    }
}

/**
 * Display hotels in the table
 */
function displayHotels(hotels) {
    const loadingDiv = document.getElementById('hotels-loading');
    const table = document.getElementById('hotels-table');
    const tbody = document.getElementById('hotels-tbody');
    
    // Hide loading, show table
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (table) table.style.display = 'table';
    
    // Clear existing rows
    if (tbody) tbody.innerHTML = '';
    
    if (hotels && hotels.length > 0) {
        hotels.forEach(hotel => {
            const row = document.createElement('tr');
            const deptList = hotel.departments && hotel.departments.length > 0 
                ? hotel.departments.join(', ') 
                : 'All Departments';
            
            row.innerHTML = `
                <td style="text-align: left;">${escapeHtml(hotel.name)}</td>
                <td style="text-align: center;">${escapeHtml(hotel.code)}</td>
                <td style="text-align: center;">${escapeHtml(deptList)}</td>
                <td style="text-align: center;">
                    <button class="btn-primary" onclick="editHotel('${hotel.id}')" style="margin-right: 5px; padding: 8px 16px;">Edit</button>
                    <button class="btn-danger" onclick="deleteHotel('${hotel.id}')">Delete</button>
                </td>
            `;
            if (tbody) tbody.appendChild(row);
        });
        
        // Also populate the hotel dropdown in the add user form
        populateHotelDropdown(hotels);
    } else {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="4" style="text-align: center; color: #666;">No hotels found</td>';
        if (tbody) tbody.appendChild(row);
        
        // Clear dropdown if no hotels
        populateHotelDropdown([]);
    }
}

/**
 * Populate the hotel dropdown in the add user form
 */
function populateHotelDropdown(hotels) {
    const hotelSelect = document.getElementById('hotelCode');
    if (!hotelSelect) return;
    
    // Clear existing options except the first "Select Hotel" option
    hotelSelect.innerHTML = '<option value="">Select Hotel</option>';
    
    if (hotels && hotels.length > 0) {
        hotels.forEach(hotel => {
            const option = document.createElement('option');
            option.value = hotel.code;
            option.textContent = `${hotel.code} - ${hotel.name}`;
            hotelSelect.appendChild(option);
        });
    }
}

/**
 * Delete hotel
 */
let hotelToDelete = null;

/**
 * Edit hotel
 */
async function editHotel(hotelId) {
    try {
        const response = await fetch('/api/admin/hotels', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const result = await response.json();
        const hotel = result.hotels.find(h => h.id === hotelId);
        
        if (!hotel) {
            showAlert('Hotel not found', 'error');
            return;
        }
        
        // Populate modal
        document.getElementById('editHotelId').value = hotel.id;
        document.getElementById('editHotelName').value = hotel.name;
        
        // Set department checkboxes
        const checkboxes = document.querySelectorAll('input[name="editDepartment"]');
        checkboxes.forEach(cb => {
            cb.checked = hotel.departments && hotel.departments.includes(cb.value);
        });
        
        // Show modal
        document.getElementById('editHotelModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading hotel:', error);
        showAlert('Error loading hotel details', 'error');
    }
}

function closeEditHotelModal() {
    document.getElementById('editHotelModal').style.display = 'none';
}

async function handleEditHotel(event) {
    event.preventDefault();
    
    const hotelId = document.getElementById('editHotelId').value;
    const name = document.getElementById('editHotelName').value;
    
    // Get selected departments
    const departments = [];
    const deptCheckboxes = document.querySelectorAll('input[name="editDepartment"]:checked');
    deptCheckboxes.forEach(cb => departments.push(cb.value));
    
    if (departments.length === 0) {
        showAlert('Please select at least one department', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/hotels/${hotelId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, departments })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Hotel updated successfully!', 'success');
            closeEditHotelModal();
            loadHotels();
        } else {
            showAlert(result.error || 'Failed to update hotel', 'error');
        }
    } catch (error) {
        console.error('Error updating hotel:', error);
        showAlert('Error updating hotel. Please try again.', 'error');
    }
}

async function deleteHotel(hotelId) {
    // First, check if hotel has users
    try {
        const response = await fetch(`/api/admin/hotels/${hotelId}/check-users`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.hasUsers) {
            // Hotel has users, show override modal
            hotelToDelete = hotelId;
            showDeleteHotelModal(result.userCount);
        } else {
            // No users, proceed with simple confirmation
            if (confirm('Are you sure you want to delete this hotel? This action cannot be undone.')) {
                performDeleteHotel(hotelId, false);
            }
        }
    } catch (error) {
        console.error('Error checking hotel users:', error);
        // Fallback to simple delete
        if (confirm('Are you sure you want to delete this hotel? This action cannot be undone.')) {
            performDeleteHotel(hotelId, false);
        }
    }
}

function showDeleteHotelModal(userCount) {
    const modal = document.getElementById('deleteHotelModal');
    const message = document.getElementById('deleteHotelMessage');
    
    if (modal && message) {
        message.innerHTML = `This hotel has <strong>${userCount}</strong> user(s).<br><br>Are you sure you want to delete this hotel and all its users?`;
        modal.style.display = 'flex';
    }
}

function closeDeleteHotelModal() {
    const modal = document.getElementById('deleteHotelModal');
    if (modal) {
        modal.style.display = 'none';
    }
    hotelToDelete = null;
}

function confirmDeleteHotelOverride() {
    if (hotelToDelete) {
        performDeleteHotel(hotelToDelete, true);
        closeDeleteHotelModal();
    }
}

async function performDeleteHotel(hotelId, override) {
    // Throttle requests
    if (!throttleRequest()) {
        showAlert('Please wait before making another request', 'error');
        return;
    }
    
    try {
        const url = override 
            ? `/api/admin/hotels/${hotelId}?override=true`
            : `/api/admin/hotels/${hotelId}`;
            
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Hotel deleted successfully!', 'success');
            loadHotels(); // Reload hotels list
        } else {
            showAlert(result.error || 'Failed to delete hotel', 'error');
        }
    } catch (error) {
        console.error('Error deleting hotel:', error);
        showAlert('Error deleting hotel. Please try again.', 'error');
    }
}

/**
 * Show alert message
 */
function showAlert(message, type) {
    // Create alert div if it doesn't exist
    let alertDiv = document.getElementById('alert');
    if (!alertDiv) {
        alertDiv = document.createElement('div');
        alertDiv.id = 'alert';
        alertDiv.className = 'alert';
        document.body.insertBefore(alertDiv, document.body.firstChild);
    }
    
    alertDiv.textContent = message;
    alertDiv.className = `alert alert-${type}`;
    alertDiv.style.display = 'block';
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.left = '50%';
    alertDiv.style.transform = 'translateX(-50%)';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.padding = '15px';
    alertDiv.style.borderRadius = '5px';
    alertDiv.style.maxWidth = '400px';
    alertDiv.style.textAlign = 'center';
    
    // Hide alert after 5 seconds
    setTimeout(() => {
        alertDiv.style.display = 'none';
    }, 5000);
}

/**
 * Navigate from admin panel back to the main dashboard.
 */
function goToDashboard() {
    window.location.href = '/';
}

/**
 * Logout function
 */
async function logout() {
    try {
        // Stop auto-refresh
        stopAutoRefresh();
        
        // Remove FCM token from database before logging out
        const fcmToken = localStorage.getItem('fcmToken');
        if (fcmToken && authToken) {
            try {
                await fetch('/api/fcm/unsubscribe', {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ fcmToken })
                });
                console.log('FCM token removed from server');
            } catch (fcmError) {
                console.error('Error removing FCM token:', fcmError);
            }
        }
        
        if (authToken) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                }
            });
        }
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        // Clear stored tokens from persistent storage
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        localStorage.removeItem('fcmToken');
        
        // Redirect to login
        window.location.href = '/login.html';
    }
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

// ============================================================================
// DARK MODE FUNCTIONALITY
// ============================================================================

/**
 * Update department dropdown options
 */
function updateDepartmentOptions(selectElement, departments, preSelectedValue = null) {
    if (!selectElement) return;

    const currentValue = preSelectedValue || selectElement.value;
    selectElement.innerHTML = '<option value="">Select Department</option>';
    
    departments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        selectElement.appendChild(option);
    });

    // Set the preselected value or restore previous selection if still valid
    if (currentValue && departments.includes(currentValue)) {
        selectElement.value = currentValue;
    }
}

/**
 * Load hotel departments for edit modal
 */
async function loadHotelDepartmentsForEdit(hotelCode, currentDepartment = null) {
    if (!hotelCode) return;
    
    try {
        const response = await fetch(`/api/hotels/${hotelCode}/departments`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            const editDepartment = document.getElementById('editDepartment');
            updateDepartmentOptions(editDepartment, result.departments, currentDepartment);
        }
    } catch (error) {
        console.error('Error loading hotel departments:', error);
    }
}

/**
 * Initialize dark mode on page load
 */
function initializeDarkMode() {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
}

/**
 * Toggle between light and dark themes
 */
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

/**
 * Set the theme and update UI
 */
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

/**
 * Check if user prefers dark mode from system settings
 */
function prefersDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Auto-detect system preference on first visit
 */
function autoDetectTheme() {
    if (!localStorage.getItem('theme')) {
        const systemPrefersDark = prefersDarkMode();
        setTheme(systemPrefersDark ? 'dark' : 'light');
    }
}
