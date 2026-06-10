const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config/config');
const logger = require('./utils/logger');
const { autenticar } = require('./middleware/auth');

// Importar rutas
const authRoutes = require('./routes/authRoutes');
const ordenRoutes = require('./routes/ordenRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const servicioRoutes = require('./routes/servicioRoutes');
const pagoRoutes = require('./routes/pagoRoutes');
const reporteRoutes = require('./routes/reporteRoutes');
const app = express();

// Configuración de trust proxy para Railway
app.set('trust proxy', 1);

// ============================================
// 1. MIDDLEWARES DE CORS (PRIMERO)
// ============================================

// Configuración CORS mejorada
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:4200',
            'http://127.0.0.1:4200',
            'https://demetriodentalfront-production.up.railway.app',
            config.frontendUrl
        ];
        
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin) || config.nodeEnv === 'development') {
            callback(null, true);
        } else {
            console.log('❌ Origen no permitido:', origin);
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
};

// APLICAR CORS PRIMERO
app.use(cors(corsOptions));

// Middleware para asegurar headers CORS (respaldo)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://demetriodentalfront-production.up.railway.app');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Responder inmediatamente a OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ============================================
// 2. MIDDLEWARES DE SEGURIDAD Y OTROS
// ============================================

// Middlewares de seguridad
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting (aplicar SOLO a rutas API)
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: { error: 'Demasiadas peticiones, intente más tarde' }
});
app.use('/api/', limiter);

// Otros middlewares
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
// Por:
if (config.nodeEnv === 'development') {
    app.use(morgan('dev')); // Logs más compactos para desarrollo
} else {
    app.use(morgan('tiny')); // Mínimo para producción
}

// Archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============================================
// 3. RUTAS PÚBLICAS
// ============================================

// Ruta de health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date(),
        environment: config.nodeEnv 
    });
});

app.get('/api/ping', (req, res) => {
    res.json({ 
        message: 'pong',
        timestamp: new Date(),
        headers: req.headers
    });
});

// Rutas públicas de autenticación
app.use('/api/auth', authRoutes);

// ============================================
// 4. RUTAS PROTEGIDAS
// ============================================
// Después de otras rutas
const notificacionesRoutes = require('./routes/notificacionesRoutes');
app.use('/api/notificaciones',autenticar, notificacionesRoutes);
app.use('/api/ordenes', autenticar, ordenRoutes);
app.use('/api/doctores', autenticar, doctorRoutes);
app.use('/api/servicios', autenticar, servicioRoutes);
app.use('/api/pagos', autenticar, pagoRoutes);
app.use('/api/reportes', autenticar, reporteRoutes);

// ============================================
// 5. MANEJADORES DE ERRORES
// ============================================

// Manejador de errores global
app.use((err, req, res, next) => {
    logger.error('Error no manejado:', err);
    
    res.status(err.status || 500).json({
        error: config.nodeEnv === 'production' 
            ? 'Error interno del servidor' 
            : err.message
    });
});

// Manejador de rutas no encontradas
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

module.exports = app;