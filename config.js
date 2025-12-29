module.exports = {
  // Database Configuration
  db: {
    user: process.env.DB_USER || 'roomsaiduser',
    password: process.env.DB_PASSWORD || 'rubbletechaiduser',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'roomaidtest',
    port: parseInt(process.env.DB_PORT) || 1434, // Use env port or default to 1434
    requestTimeout: 60000, // 60 seconds
    connectionTimeout: 60000, // 60 seconds
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true', // set to true if using Azure/Aiven
      trustServerCertificate: process.env.NODE_ENV !== 'production' || process.env.DB_TRUST_CERT === 'true', // allow explicit trust
      enableArithAbort: true,
      requestTimeout: 60000,
      connectionTimeout: 60000
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  },

  // Server Configuration
  server: {
    port: process.env.PORT || 3000
  },

  // JWT Secret
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-here'
}; 
