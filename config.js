function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const dbEncrypt = parseBoolean(process.env.DB_ENCRYPT, false);
const dbTrustCert = parseBoolean(process.env.DB_TRUST_CERT, false);

const sslConfig = dbEncrypt
  ? {
      // If DB_TRUST_CERT is true, skip CA verification. Otherwise verify certificates.
      rejectUnauthorized: !dbTrustCert,
      ...(process.env.DB_SSL_CA
        ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') }
        : {})
    }
  : null;

module.exports = {
  // Database Configuration
  db: {
    host: process.env.DB_SERVER || process.env.DB_HOST || 'roomaid-962-room-aid-962.e.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'room',
    port: parseInt(process.env.DB_PORT, 10) || 24815,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '20000', 10),
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    ssl: sslConfig
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
