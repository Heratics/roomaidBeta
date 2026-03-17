/**
 * RoomAid Input Validation and Sanitization Module
 * Provides comprehensive input validation, sanitization, and security functions
 * Protects against SQL injection, XSS, and other common web vulnerabilities
 */

// ============================================================================
// INPUT VALIDATION FUNCTIONS
// ============================================================================

/**
 * Sanitize string input to prevent XSS attacks
 * @param {string} input - Input string to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/['"]/g, '') // Remove quotes that could break SQL
    .replace(/[;]/g, '') // Remove semicolons
    .replace(/[--]/g, '') // Remove SQL comment markers
    .replace(/[/*]/g, '') // Remove SQL comment markers
    .replace(/[\\]/g, '') // Remove backslashes
    .trim();
}

/**
 * Validate and sanitize room number input
 * @param {string} roomNumber - Room number to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateRoomNumber(roomNumber) {
  if (!roomNumber || typeof roomNumber !== 'string') {
    return { isValid: false, value: '', error: 'Room number is required' };
  }
  
  const sanitized = sanitizeString(roomNumber);
  
  // Room number should be alphanumeric and reasonable length
  if (!/^[A-Za-z0-9\s-]{1,20}$/.test(sanitized)) {
    return { isValid: false, value: '', error: 'Invalid room number format' };
  }
  
  return { isValid: true, value: sanitized, error: null };
}

/**
 * Validate and sanitize username input
 * @param {string} username - Username to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { isValid: false, value: '', error: 'Username is required' };
  }
  
  const sanitized = sanitizeString(username);
  
  // Username should be alphanumeric and reasonable length
  if (!/^[A-Za-z0-9_]{3,30}$/.test(sanitized)) {
    return { isValid: false, value: '', error: 'Username must be 3-30 characters, alphanumeric and underscores only' };
  }
  
  return { isValid: true, value: sanitized, error: null };
}

/**
 * Validate and sanitize password input
 * @param {string} password - Password to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { isValid: false, value: '', error: 'Password is required' };
  }
  
  // Password should be at least 6 characters
  if (password.length < 6) {
    return { isValid: false, value: '', error: 'Password must be at least 6 characters' };
  }
  
  // Don't sanitize password as it might contain special characters
  return { isValid: true, value: password, error: null };
}

/**
 * Validate and sanitize hotel code input
 * @param {string} hotelCode - Hotel code to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateHotelCode(hotelCode) {
  if (!hotelCode || typeof hotelCode !== 'string') {
    return { isValid: false, value: '', error: 'Hotel code is required' };
  }
  
  const sanitized = sanitizeString(hotelCode.toUpperCase());
  
  // Hotel code should be alphanumeric and reasonable length
  if (!/^[A-Z0-9]{3,20}$/.test(sanitized)) {
    return { isValid: false, value: '', error: 'Hotel code must be 3-20 characters, alphanumeric only' };
  }
  
  return { isValid: true, value: sanitized, error: null };
}

/**
 * Validate and sanitize notes input
 * @param {string} notes - Notes to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateNotes(notes) {
  if (!notes) {
    return { isValid: true, value: '', error: null };
  }
  
  if (typeof notes !== 'string') {
    return { isValid: false, value: '', error: 'Notes must be text' };
  }
  
  const sanitized = sanitizeString(notes);
  
  // Notes should be reasonable length
  if (sanitized.length > 500) {
    return { isValid: false, value: '', error: 'Notes must be 500 characters or less' };
  }
  
  return { isValid: true, value: sanitized, error: null };
}

/**
 * Validate and sanitize department input
 * @param {string} department - Department to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateDepartment(department) {
  if (!department || typeof department !== 'string') {
    return { isValid: false, value: '', error: 'Department is required' };
  }
  
  const sanitized = sanitizeString(department);
  const validDepartments = ['Engineering', 'Housekeeping', 'Laundry', 'Room Service'];
  
  if (!validDepartments.includes(sanitized)) {
    return { isValid: false, value: '', error: 'Invalid department' };
  }
  
  return { isValid: true, value: sanitized, error: null };
}

/**
 * Validate and sanitize date input
 * @param {string} date - Date to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateDate(date) {
  if (!date) {
    return { isValid: true, value: null, error: null };
  }
  
  if (typeof date !== 'string') {
    return { isValid: false, value: null, error: 'Date must be a string' };
  }
  
  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { isValid: false, value: null, error: 'Invalid date format' };
  }
  
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    return { isValid: false, value: null, error: 'Invalid date' };
  }
  
  return { isValid: true, value: date, error: null };
}

// ============================================================================
// XSS PROTECTION FUNCTIONS
// ============================================================================

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
function escapeHtml(text) {
  if (typeof text !== 'string') {
    return '';
  }
  
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

/**
 * Escape HTML attributes to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Attribute-escaped text
 */
function escapeHtmlAttribute(text) {
  if (typeof text !== 'string') {
    return '';
  }
  
  return text
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// RATE LIMITING UTILITIES
// ============================================================================

// Simple in-memory rate limiting store
const rateLimitStore = new Map();

/**
 * Check if request should be rate limited
 * @param {string} identifier - Unique identifier (IP, user ID, etc.)
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} True if request should be allowed
 */
function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const key = `${identifier}_${Math.floor(now / windowMs)}`;
  
  const current = rateLimitStore.get(key) || 0;
  
  if (current >= maxRequests) {
    return false;
  }
  
  rateLimitStore.set(key, current + 1);
  
  // Clean up old entries periodically
  if (Math.random() < 0.01) { // 1% chance to clean up
    const cutoff = now - (windowMs * 2);
    for (const [k, v] of rateLimitStore.entries()) {
      if (k.includes('_') && parseInt(k.split('_')[1]) * windowMs < cutoff) {
        rateLimitStore.delete(k);
      }
    }
  }
  
  return true;
}

// ============================================================================
// SECURITY HEADERS
// ============================================================================

/**
 * Get security headers for Express.js
 * @returns {Object} Security headers object
 */
function getSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
  };
}

module.exports = {
  // Validation functions
  sanitizeString,
  validateRoomNumber,
  validateUsername,
  validatePassword,
  validateHotelCode,
  validateNotes,
  validateDepartment,
  validateDate,
  
  // XSS protection
  escapeHtml,
  escapeHtmlAttribute,
  
  // Rate limiting
  checkRateLimit,
  
  // Security headers
  getSecurityHeaders
};
