process.env.TZ = 'America/Lima';  // Configurar zona horaria a Perú
const app = require('./src/app');
const config = require('./src/config/config');
const { sequelize } = require('./src/models');
const logger = require('./src/utils/logger');
const cron = require('node-cron');  // ✅ Movido arriba con los otros requires

const PORT = config.port || 3000;

// Logs simples para Railway (funcionan siempre)
console.log(`🕐 Zona horaria configurada: ${process.env.TZ}`);
console.log(`🕐 Hora actual del servidor: ${new Date().toLocaleString('es-PE')}`);
console.log(`📝 Entorno: ${config.nodeEnv}`);
console.log(`🔧 Configuración DB: ${config.db.host}:${config.db.port}/${config.db.name}`);

// Verificar conexión a la base de datos
async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        console.log('✅ Conexión a la base de datos establecida correctamente.');

        await sequelize.query("SET time_zone = '-05:00'");
        console.log('🕐 Zona horaria MySQL configurada a Perú (UTC-5)');
        
        if (config.nodeEnv === 'development') {
            await sequelize.sync({ alter: false });
            console.log('📊 Modelos verificados con la base de datos.');
        }
    } catch (error) {
        console.error('❌ Error conectando a la base de datos:', error.message);
        process.exit(1);
    }
}

// Iniciar servidor
// Iniciar servidor
async function startServer() {
    await initializeDatabase();  // ✅ Primero conectamos DB
    
    // ✅ CRON JOB - Limpiar logs (existente)
    cron.schedule('0 2 * * *', async () => {
        try {
            console.log('🕑 Ejecutando limpieza de logs (2:00 AM hora Perú)...');
            const [result] = await sequelize.query(
                `DELETE FROM logs_actividad WHERE creado_en < DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );
            console.log(`🗑️ Logs limpiados: ${result.affectedRows} registros eliminados`);
        } catch (error) {
            console.error('❌ Error limpiando logs:', error.message);
        }
    });
    
    // ✅ NUEVO CRON JOB - Limpiar tokens FCM antiguos (cada domingo a las 3:00 AM)
    cron.schedule('0 3 * * 0', async () => {
        try {
            console.log('🕑 Ejecutando limpieza de tokens FCM antiguos (Domingo 3:00 AM)...');
            
            const fechaLimite = new Date();
            fechaLimite.setDate(fechaLimite.getDate() - 60); // Tokens con más de 60 días
            
            const [result] = await sequelize.query(
                `DELETE FROM tokens_fcm 
                 WHERE activo = 0 
                 AND actualizado_en < :fechaLimite`,
                { replacements: { fechaLimite: fechaLimite } }
            );
            
            console.log(`🗑️ Tokens FCM antiguos eliminados: ${result.affectedRows} registros`);
        } catch (error) {
            console.error('❌ Error limpiando tokens FCM:', error.message);
        }
    });
    
    const server = app.listen(PORT, () => {
        console.log(`
        =====================================
        🚀 Servidor corriendo en puerto: ${PORT}
        📝 Entorno: ${config.nodeEnv}
        🕐 Zona horaria: ${process.env.TZ}
        🔗 API URL: http://localhost:${PORT}/api
        =====================================
        `);
    });

    process.on('SIGTERM', () => {
        console.log('SIGTERM recibido. Cerrando servidor...');
        server.close(() => {
            console.log('Servidor cerrado.');
            sequelize.close();
        });
    });
}

startServer();