module.exports = {
  // Database Configuration
  db: {
    host: process.env.DB_SERVER || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'roomaid',
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.DB_ENCRYPT === 'true' ? {
      rejectUnauthorized: process.env.DB_TRUST_CERT !== 'true'
    } : null
  },

  // Server Configuration
  server: {
    port: process.env.PORT || 3000
  },

  // JWT Secret
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-here'
}; 
