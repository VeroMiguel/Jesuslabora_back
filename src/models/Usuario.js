const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');

const Usuario = sequelize.define('Usuario', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nombre_usuario: {
        type: DataTypes.STRING(50),
        unique: true,
        allowNull: false,
        validate: {
            len: [3, 50]
        }
    },
    contrasena_hash: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    nombre_completo: {
        type: DataTypes.STRING(100)
    },
    email: {
        type: DataTypes.STRING(100),
        unique: true,
        validate: {
            isEmail: true
        }
    },
    rol: {
        type: DataTypes.ENUM('admin', 'operador', 'supervisor'),
        defaultValue: 'operador'
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    ultimo_acceso: {
        type: DataTypes.DATE
    },
    ultimo_ip: {
        type: DataTypes.STRING(45)
    },
    intentos_fallidos: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    bloqueado_hasta: {
        type: DataTypes.DATE
    }
}, {
    tableName: 'usuarios',
    hooks: {
        beforeCreate: async (usuario) => {
            if (usuario.contrasena_hash) {
                usuario.contrasena_hash = await bcrypt.hash(usuario.contrasena_hash, 10);
            }
        },
        beforeUpdate: async (usuario) => {
            if (usuario.changed('contrasena_hash')) {
                usuario.contrasena_hash = await bcrypt.hash(usuario.contrasena_hash, 10);
            }
        }
    }
});

// Métodos de instancia
Usuario.prototype.validarContrasena = async function(contrasena) {
    return bcrypt.compare(contrasena, this.contrasena_hash);
};

Usuario.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    delete values.contrasena_hash;
    return values;
};

module.exports = Usuario;