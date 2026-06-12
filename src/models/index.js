const sequelize = require('../config/database');
const Usuario = require('./Usuario');
const Doctor = require('./Doctor');
const Servicio = require('./Servicio');
const Orden = require('./Orden');
const Pago = require('./Pago');
const Configuracion = require('./Configuracion');
const TokenFCM = require('./TokenFCM');  // ✅ AGREGAR ESTA LÍNEA
const DetalleOrden = require('./DetalleOrden');
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

// models/index.js - MODIFICAR LAS ASOCIACIONES

// AGREGAR RELACIONES - Cambiar el nombre de 'orden' a 'ordenPrincipal' o algo similar
Orden.hasMany(DetalleOrden, { 
    foreignKey: 'orden_id', 
    as: 'detalles',
    onDelete: 'CASCADE'
});

// ✅ CAMBIAR 'orden' por 'ordenPrincipal' para evitar conflicto con la columna 'orden'
DetalleOrden.belongsTo(Orden, { 
    foreignKey: 'orden_id', 
    as: 'ordenPrincipal'
});

DetalleOrden.belongsTo(Servicio, { 
    foreignKey: 'servicio_id', 
    as: 'servicio'
});

Servicio.hasMany(DetalleOrden, { 
    foreignKey: 'servicio_id', 
    as: 'detalles_orden'
});





module.exports = {
    sequelize,
    Usuario,
    Doctor,
    Servicio,
    Orden,
    DetalleOrden,  // <-- AGREGAR
    Pago,
    Configuracion,
    TokenFCM
};