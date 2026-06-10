const dotenv = require('dotenv');
const path = require('path');

// Solo cargar .env en desarrollo local
if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.join(__dirname, '../../.env') });
}

// Log de variables para debug (solo en desarrollo o con flag)
if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
    console.log('🔧 Configuración de base de datos:');
    console.log(`   Host: ${process.env.DB_HOST || process.env.MYSQLHOST || 'localhost'}`);
    console.log(`   Port: ${process.env.DB_PORT || process.env.MYSQLPORT || 3306}`);
    console.log(`   Name: ${process.env.DB_NAME || process.env.MYSQLDATABASE || 'jesuslab_db'}`);
    console.log(`   User: ${process.env.DB_USER || process.env.MYSQLUSER || 'root'}`);
}

module.exports = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT) || 3000,
    
    db: {
        host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
        name: process.env.DB_NAME || process.env.MYSQLDATABASE || 'jesuslab_db',
        user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
        password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
        dialect: 'mysql',
       pool: {
        max: 3,      // Reducir de 5 a 3
        min: 0,
        acquire: 10000,
        idle: 5000
}
    },
    
    jwtSecret: process.env.JWT_SECRET || 'dev_secret_key',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 15 * 1024 * 1024, // 15MB
        rateLimit: {
            windowMs: 15 * 60 * 1000,
            max: 100
        }
};