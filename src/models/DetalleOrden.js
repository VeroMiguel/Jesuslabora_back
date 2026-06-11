// models/DetalleOrden.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DetalleOrden = sequelize.define('DetalleOrden', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    orden_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'ordenes',
            key: 'id'
        }
    },
    servicio_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'servicios',
            key: 'id'
        }
    },
    cantidad: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 1
        }
    },
    precio_unitario: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    fecha_limite: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    hora_limite: {
        type: DataTypes.TIME,
        allowNull: true
    }
}, {
    tableName: 'detalles_orden',
    timestamps: true,
    underscored: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en'
});

module.exports = DetalleOrden;