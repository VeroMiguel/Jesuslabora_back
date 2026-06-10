const sequelize = require('../config/database');
const Usuario = require('./Usuario');
const Doctor = require('./Doctor');
const Servicio = require('./Servicio');
const Orden = require('./Orden');
const Pago = require('./Pago');
const Configuracion = require('./Configuracion');
const TokenFCM = require('./TokenFCM');  // ✅ AGREGAR ESTA LÍNEA
// Definir relaciones con opciones explícitas
Doctor.hasMany(Orden, { 
    foreignKey: 'doctor_id', 
    as: 'ordenes',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
});

Orden.belongsTo(Doctor, { 
    foreignKey: 'doctor_id', 
    as: 'doctor',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
});

Servicio.hasMany(Orden, { 
    foreignKey: 'servicio_id', 
    as: 'ordenes',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
});

Orden.belongsTo(Servicio, { 
    foreignKey: 'servicio_id', 
    as: 'servicio',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
});

Usuario.hasMany(Orden, { 
    foreignKey: 'usuario_creo_id', 
    as: 'ordenes_creadas',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
});

Orden.belongsTo(Usuario, { 
    foreignKey: 'usuario_creo_id', 
    as: 'usuario_creo',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
});

Orden.hasMany(Pago, { 
    foreignKey: 'orden_id', 
    as: 'pagos',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
});

Pago.belongsTo(Orden, { 
    foreignKey: 'orden_id', 
    as: 'orden',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
});

Usuario.hasMany(Pago, { 
    foreignKey: 'usuario_registro_id', 
    as: 'pagos_registrados',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
});

Pago.belongsTo(Usuario, { 
    foreignKey: 'usuario_registro_id', 
    as: 'usuario_registro',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
});

// ✅ Relaciones con TokenFCM
Usuario.hasMany(TokenFCM, { 
    foreignKey: 'usuario_id', 
    as: 'tokens_fcm',
    onDelete: 'CASCADE'
});
TokenFCM.belongsTo(Usuario, { 
    foreignKey: 'usuario_id', 
    as: 'usuario'
});
module.exports = {
    sequelize,
    Usuario,
    Doctor,
    Servicio,
    Orden,
    Pago,
    Configuracion,
    TokenFCM  // ✅ AGREGAR ESTA LÍNEA
};