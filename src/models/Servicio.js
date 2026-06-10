const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Servicio = sequelize.define('Servicio', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nombre: {
        type: DataTypes.STRING(100),
        unique: true,
        allowNull: false
    },
    precio_referencial: {
        type: DataTypes.DECIMAL(10, 2),
        validate: {
            min: 0
        }
    },
    imagen_url: {  // <-- NUEVO CAMPO
        type: DataTypes.TEXT
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'servicios'
});

module.exports = Servicio;