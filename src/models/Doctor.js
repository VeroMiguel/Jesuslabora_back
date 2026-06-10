const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Doctor = sequelize.define('Doctor', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nombre: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    telefono_whatsapp: {
        type: DataTypes.STRING(20),
        validate: {
            is: /^[0-9+\-\s]+$/i
        }
    },
    logo_url: {
        type: DataTypes.TEXT
    },
    direccion: {
        type: DataTypes.TEXT
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'doctores'
});

module.exports = Doctor;