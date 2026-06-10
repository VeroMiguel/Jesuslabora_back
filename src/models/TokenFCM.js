const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TokenFCM = sequelize.define('TokenFCM', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    token: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true
    },
    usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'usuarios',
            key: 'id'
        }
    },
    dispositivo: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    plataforma: {
        type: DataTypes.ENUM('web', 'android', 'ios', 'windows', 'mac'),
        defaultValue: 'web'
    },
    ultimo_uso: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'tokens_fcm',
    timestamps: true,
    underscored: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en'
});

module.exports = TokenFCM;