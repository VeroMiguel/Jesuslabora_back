// ordenRoutes.js - VERSIÓN COMPLETA Y CORREGIDA
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config/config');
const { 
    obtenerOrdenes, 
    obtenerOrdenPorId,
    crearOrden, 
    actualizarOrden, 
    eliminarOrden,
    obtenerEstadisticas,
    obtenerIngresosMensuales,
    obtenerFechaServidor,
    actualizarImagenReferencia,
    obtenerFechaHoraServidor,
    obtenerOrdenesConFiltrosAvanzados,
    actualizarImagenDetalle,
    eliminarImagenDetalle,
    actualizarDetalleOrden
} = require('../controllers/ordenController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarOrden } = require('../middleware/validator');

// Configuración de multer
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        let uploadDir;
        
        // Determinar directorio según la ruta
        if (req.originalUrl.includes('/detalles/')) {
            uploadDir = path.join(__dirname, '../../uploads/detalles');
        } else {
            uploadDir = path.join(__dirname, '../../uploads/ordenes');
        }
        
        await fs.ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: config.maxFileSize },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|avif|heic|heif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten imágenes'));
    }
});

// ============================================
// PRIMERO: RUTAS ESPECÍFICAS (sin parámetros dinámicos)
// ============================================
router.get('/estadisticas', autenticar, obtenerEstadisticas);
router.get('/ingresos/mensuales', autenticar, obtenerIngresosMensuales);
router.get('/server-time', autenticar, obtenerFechaServidor);
router.get('/server-datetime', autenticar, obtenerFechaHoraServidor);

// Ruta para filtros avanzados (DEBE ir ANTES de /:id)
router.get('/filtros-avanzados', autenticar, obtenerOrdenesConFiltrosAvanzados);

// ============================================
// NUEVAS RUTAS PARA DETALLES (IMÁGENES POR SERVICIO)
// ============================================
router.post('/detalles/:detalleId/imagen', autenticar, upload.single('imagen'), actualizarImagenDetalle);
router.delete('/detalles/:detalleId/imagen', autenticar, eliminarImagenDetalle);

// ============================================
// LUEGO: RUTAS CON PARÁMETROS
// ============================================
router.get('/', autenticar, obtenerOrdenes);
router.get('/:id', autenticar, obtenerOrdenPorId);

// ============================================
// RUTAS POST, PUT Y DELETE
// ============================================
router.post('/', autenticar, upload.single('imagen_referencia'), crearOrden);
router.put('/:id', autenticar, upload.single('imagen_referencia'), actualizarOrden);
router.delete('/:id', autenticar, autorizar('admin'), eliminarOrden);

// Subir imagen de referencia para orden completa (mantener por compatibilidad)
router.post('/:id/imagen-referencia', autenticar, upload.single('imagen'), actualizarImagenReferencia);
// ordenRoutes.js - AGREGAR ESTA RUTA

// ============================================
// RUTAS PARA DETALLES (actualizar cliente)
// ============================================
router.put('/detalles/:detalleId', autenticar, actualizarDetalleOrden);
module.exports = router;