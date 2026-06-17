// routes/logoRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { autenticar } = require('../middleware/auth');
const fileService = require('../services/fileService');
const { Configuracion } = require('../models');

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/logo');
        await fs.ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten imágenes'));
    }
});

// ✅ GET - PÚBLICO (sin autenticación)
router.get('/logo', async (req, res) => {
    try {
        const config = await Configuracion.findOne({ where: { clave: 'logo_url' } });
        res.json({ logo_url: config?.valor || null });
    } catch (error) {
        console.error('Error obteniendo logo:', error);
        res.status(500).json({ error: 'Error al obtener logo' });
    }
});

// POST - Requiere autenticación
router.post('/logo', autenticar, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó ninguna imagen' });
        }
        
        const imagen_url = await fileService.saveFile(req.file, 'logo');
        
        const [config, created] = await Configuracion.findOrCreate({
            where: { clave: 'logo_url' },
            defaults: { clave: 'logo_url', valor: imagen_url, tipo_dato: 'texto' }
        });
        
        if (!created) {
            if (config.valor) {
                await fileService.deleteFile(config.valor);
            }
            await config.update({ valor: imagen_url });
        }
        
        res.json({ mensaje: 'Logo guardado correctamente', logo_url: imagen_url });
    } catch (error) {
        console.error('Error subiendo logo:', error);
        res.status(500).json({ error: 'Error al guardar logo' });
    }
});

// DELETE - Requiere autenticación
router.delete('/logo', autenticar, async (req, res) => {
    try {
        const config = await Configuracion.findOne({ where: { clave: 'logo_url' } });
        if (config && config.valor) {
            await fileService.deleteFile(config.valor);
            await config.update({ valor: null });
        }
        res.json({ mensaje: 'Logo eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando logo:', error);
        res.status(500).json({ error: 'Error al eliminar logo' });
    }
});

module.exports = router;