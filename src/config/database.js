const { Sequelize } = require('sequelize');
const config = require('./config');

// database.js - Cambiar logging
const sequelize = new Sequelize(
    config.db.name,
    config.db.user,
    config.db.password,
    {
        host: config.db.host,
        port: config.db.port,
        dialect: config.db.dialect,
        logging: false,  // ✅ Cambiar a false para desactivar logs SQL
        pool: config.db.pool,
        timezone: '-05:00',
        define: {
            timestamps: true,
            underscored: true,
            createdAt: 'creado_en',
            updatedAt: 'actualizado_en'
        }
    }
);

module.exports = sequelize;