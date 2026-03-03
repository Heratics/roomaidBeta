module.exports = {
  // Database Configuration
  db: {
    host: process.env.DB_SERVER || 'roomaid26database-rb-roomaid26.d.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || 'AVNS_PP4bZhJVOxOkSxYHari',
    database: process.env.DB_NAME || 'RoomAid',
    port: parseInt(process.env.DB_PORT) || 23847,
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
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-here',

  // Web Push (VAPID) Configuration
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
}; 
