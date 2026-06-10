const winston = require('winston');
const path = require('path');
const config = require('../config/config');

const logDir = 'logs';

const logger = winston.createLogger({
    level: config.nodeEnv === 'production' ? 'warn' : 'warn', // ✅ Cambiar a 'warn' para menos logs
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'labtrack-backend' },
    transports: [
        new winston.transports.File({ 
            filename: path.join(logDir, 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(logDir, 'combined.log') 
        })
    ]
});

// En desarrollo, también reducir los logs de consola
if (config.nodeEnv !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
        level: 'warn' // ✅ Solo warnings y errores
    }));
}

module.exports = logger;