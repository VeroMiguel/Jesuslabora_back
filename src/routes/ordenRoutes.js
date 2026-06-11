// ordenRoutes.js - CON AUTENTICACIÓN
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
    obtenerOrdenesConFiltrosAvanzados // NUEVA FUNCIONALIDAD
} = require('../controllers/ordenController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarOrden } = require('../middleware/validator');

// Configuración de multer para subida de imágenes
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/ordenes');
        await fs.ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Cambia el límite de 5MB a 15MB
const upload = multer({
    storage: storage,
     limits: { fileSize: config.maxFileSize }, // Usar config
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

// PRIMERO las rutas específicas (sin parámetros dinámicos)
router.get('/estadisticas', autenticar, obtenerEstadisticas);
router.get('/ingresos/mensuales', autenticar, obtenerIngresosMensuales);
router.get('/server-time', autenticar, obtenerFechaServidor);
router.get('/server-datetime', autenticar, obtenerFechaHoraServidor); // NUEVA RUTA - SOLO UNA VEZ

// LUEGO las rutas con parámetros
router.get('/', autenticar, obtenerOrdenes);
router.get('/:id', autenticar, obtenerOrdenPorId);
// Rutas POST y PUT con multer para manejar imágenes
router.post('/', autenticar, upload.single('imagen_referencia'), validarOrden, crearOrden);
router.put('/:id', autenticar, upload.single('imagen_referencia'), actualizarOrden);
router.delete('/:id', autenticar, autorizar('admin'), eliminarOrden);

// NUEVA RUTA: Subir imagen de referencia para una orden (con autenticación)
router.post('/:id/imagen-referencia', autenticar, upload.single('imagen'), actualizarImagenReferencia);
// En ordenRoutes.js - AGREGAR:
router.get('/filtros-avanzados', autenticar, obtenerOrdenesConFiltrosAvanzados);
module.exports = router;