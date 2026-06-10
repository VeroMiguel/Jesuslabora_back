const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Orden = sequelize.define('Orden', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    id_externo: {
        type: DataTypes.STRING(50)
    },
    doctor_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'doctores',
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
    usuario_creo_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'usuarios',
            key: 'id'
        }
    },
    total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    estado: {
        type: DataTypes.ENUM('pendiente', 'terminado'),
        defaultValue: 'pendiente'
    },
    prioridad: {
        type: DataTypes.ENUM('normal', 'urgente', 'emergencia'),
        defaultValue: 'normal'
    },
    fecha_registro: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    fecha_inicio: {
        type: DataTypes.DATEONLY
    },
    hora_inicio: {
        type: DataTypes.TIME
    },
    fecha_limite: {
        type: DataTypes.DATEONLY
    },
    hora_limite: {
        type: DataTypes.TIME
    },
    cliente_nombre: {
        type: DataTypes.TEXT
    },
    detalle_cliente: {  // <-- NUEVO CAMPO
        type: DataTypes.TEXT,
        allowNull: true
    },
     imagen_referencia_url: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'ordenes',
    timestamps: true,
    underscored: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en'
});

module.exports = Orden;