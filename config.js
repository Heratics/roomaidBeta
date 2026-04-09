function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const dbEncrypt = parseBoolean(readEnv('DB_ENCRYPT'), false);
const dbTrustCert = parseBoolean(readEnv('DB_TRUST_CERT'), false);

const sslConfig = dbEncrypt
  ? {
      // If DB_TRUST_CERT is true, skip CA verification. Otherwise verify certificates.
      rejectUnauthorized: !dbTrustCert,
      ...(readEnv('DB_SSL_CA')
        ? { ca: readEnv('DB_SSL_CA').replace(/\\n/g, '\n') }
        : {})
    }
  : null;

module.exports = {
  // Database Configuration
  db: {
    host: readEnv('DB_SERVER') || readEnv('DB_HOST') || 'roomaid-962-room-aid-962.e.aivencloud.com',
    user: readEnv('DB_USER') || 'avnadmin',
    password: readEnv('DB_PASSWORD') || '',
    database: readEnv('DB_NAME') || 'room',
    port: parseInt(readEnv('DB_PORT'), 10) || 24815,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: parseInt(readEnv('DB_CONNECT_TIMEOUT') || '20000', 10),
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
