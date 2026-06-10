const jwt = require('jsonwebtoken');
const { Usuario } = require('../models');
const config = require('../config/config');
const logger = require('../utils/logger');

const autenticar = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            logger.warn('Intento de acceso sin token');
            return res.status(401).json({ 
                error: 'Token no proporcionado' 
            });
        }

        const token = authHeader.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                error: 'Token no proporcionado' 
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, config.jwtSecret);
        } catch (jwtError) {
            logger.warn('Token inválido o expirado');
            return res.status(401).json({ 
                error: 'Token inválido o expirado' 
            });
        }

        const usuario = await Usuario.findOne({ 
            where: { 
                id: decoded.id, 
                activo: true 
            } 
        });

        if (!usuario) {
            logger.warn(`Usuario no encontrado o inactivo: ${decoded.id}`);
            return res.status(401).json({ 
                error: 'Usuario no encontrado o inactivo' 
            });
        }

        req.usuario = usuario;
        req.token = token;
        next();
    } catch (error) {
        logger.error('Error en autenticación:', error);
        res.status(401).json({ 
            error: 'Error de autenticación' 
        });
    }
};

const autorizar = (...roles) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ 
                error: 'Usuario no autenticado' 
            });
        }

        if (!roles.includes(req.usuario.rol)) {
            logger.warn(`Usuario ${req.usuario.id} intentó acceder sin permisos`);
            return res.status(403).json({ 
                error: 'No tiene permisos para acceder a este recurso' 
            });
        }

        next();
    };
};

module.exports = { autenticar, autorizar };