const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const config = require('../config/config');
const { 
    obtenerServicios, 
    obtenerServicioPorId, 
    crearServicio, 
    actualizarServicio, 
    eliminarServicio,
    obtenerServiciosPorCategoria 
} = require('../controllers/servicioController');
const { autenticar, autorizar } = require('../middleware/auth');
const { validarServicio } = require('../middleware/validator');

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads/temp'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `temp-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: config.maxFileSize }, // Usar config (15MB)
    fileFilter: (req, file, cb) => {
        // Soporte para formatos comunes y HEIC/HEIF (iPhone)
        const allowedTypes = /jpeg|jpg|png|gif|avif|webp|heic|heif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif, avif, webp, heic, heif)'));
        }
    }
});

// Rutas
router.get('/', autenticar, obtenerServicios);
router.get('/categorias', autenticar, obtenerServiciosPorCategoria);
router.get('/:id', autenticar, obtenerServicioPorId);
router.post('/', 
    autenticar, 
    autorizar('admin', 'supervisor'),
    upload.single('imagen'),
    validarServicio,
    crearServicio
);
router.put('/:id', 
    autenticar, 
    autorizar('admin', 'supervisor'),
    upload.single('imagen'),
    validarServicio,
    actualizarServicio
);
router.delete('/:id', 
    autenticar, 
    autorizar('admin'),
    eliminarServicio
);

module.exports = router;