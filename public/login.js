// ============================================================================
// ROOMAID LOGIN PAGE JAVASCRIPT
// ============================================================================

// Global state for login
let currentUser = null;
let currentToken = null;

// DOM elements
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const togglePasswordBtn = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');
const themeToggle = document.getElementById('themeToggle');

// Initialize login page
document.addEventListener('DOMContentLoaded', function() {
    // Initialize dark mode
    initializeDarkMode();
    autoDetectTheme();
    
    // Check if user already has an active session
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
        // User is already logged in, redirect to dashboard
        currentToken = savedToken;
        currentUser = JSON.parse(savedUser);
        redirectToDashboard();
    }
    
    setupEventListeners();
});

// Event listeners
function setupEventListeners() {
    // Login form
    loginForm.addEventListener('submit', handleLogin);
    
    // Password toggle
    if (togglePasswordBtn) {
        togglePasswordBtn.addEventListener('click', togglePasswordVisibility);
    }
    
    // Dark mode toggle
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleDarkMode);
    }
}

// Input validation functions for login
function validateLoginInput(username, password, hotelCode) {
    // Validate username
    if (!username || typeof username !== 'string') {
        return { isValid: false, error: 'Username is required' };
    }
    
    const sanitizedUsername = username.trim().replace(/[<>'";\\]/g, '');
    if (!/^[A-Za-z0-9_]{3,30}$/.test(sanitizedUsername)) {
        return { isValid: false, error: 'Username must be 3-30 characters, alphanumeric and underscores only' };
    }
    
    // Validate password
    if (!password || typeof password !== 'string') {
        return { isValid: false, error: 'Password is required' };
    }
    
    if (password.length < 6) {
        return { isValid: false, error: 'Password must be at least 6 characters' };
    }
    
    // Validate hotel code
    if (!hotelCode || typeof hotelCode !== 'string') {
        return { isValid: false, error: 'Hotel code is required' };
    }
    
    const sanitizedHotelCode = hotelCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{3,20}$/.test(sanitizedHotelCode)) {
        return { isValid: false, error: 'Hotel code must be 3-20 characters, alphanumeric only' };
    }
    
    return { 
        isValid: true, 
        values: {
            username: sanitizedUsername,
            password: password,
            hotelCode: sanitizedHotelCode
        }
    };
}

// Login handler
async function handleLogin(e) {
    e.preventDefault();
    
    const formData = new FormData(loginForm);
    const username = formData.get('username');
    const password = formData.get('password');
    const hotelCode = formData.get('hotelCode');
    
    // Validate and sanitize input
    const validation = validateLoginInput(username, password, hotelCode);
    
    if (!validation.isValid) {
        showLoginError(validation.error);
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(validation.values)
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Store authentication data
            currentToken = data.token;
            currentUser = data.user;
            
            // Save to persistent storage for week-long sessions
            localStorage.setItem('authToken', currentToken);
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            // Redirect to dashboard
            redirectToDashboard();
            
        } else {
            const errorData = await response.json();
            showLoginError(errorData.error || 'Login failed. Please check your credentials.');
        }
    } catch (error) {
        console.error('Login error:', error);
        showLoginError('An error occurred. Please try again.');
    }
}

// Redirect to dashboard page
function redirectToDashboard() {
    // Redirect to the dashboard page
    window.location.href = 'index.html';
}

// Show login error message
function showLoginError(message) {
    loginError.textContent = message;
    loginError.style.display = 'block';
    
    // Hide error after 5 seconds
    setTimeout(() => {
        loginError.style.display = 'none';
    }, 5000);
}

// Toggle password visibility
function togglePasswordVisibility() {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    
    // Update button icon
    togglePasswordBtn.textContent = type === 'password' ? '🙈' : '👁️';
}

// Seed data function (for development)
async function seedData() {
    try {
        const response = await fetch('/api/seed', {
            method: 'POST'
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('Sample data created:', data);
            alert('Sample data created! You can now login with:\nUsername: admin\nPassword: password123\nHotel Code: HOTEL001');
        } else {
            console.error('Failed to seed data');
        }
    } catch (error) {
        console.error('Error seeding data:', error);
    }
}

// Expose seed function globally for development
window.seedData = seedData;

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
