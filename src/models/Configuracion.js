const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Configuracion = sequelize.define('Configuracion', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    clave: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true
        }
    },
    valor: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    tipo_dato: {
        type: DataTypes.ENUM('texto', 'numero', 'booleano', 'json'),
        defaultValue: 'texto'
    },
    descripcion: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'configuraciones',
    timestamps: true,
    underscored: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en'
});

module.exports = Configuracion;