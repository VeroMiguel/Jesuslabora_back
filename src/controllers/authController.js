const jwt = require('jsonwebtoken');
const { Usuario } = require('../models');
const config = require('../config/config');
const logger = require('../utils/logger');

const login = async (req, res) => {
    try {
        const { nombre_usuario, contrasena } = req.body;

        // Buscar usuario
        const usuario = await Usuario.findOne({ 
            where: { 
                nombre_usuario,
                activo: true 
            } 
        });

        if (!usuario) {
            logger.warn(`Intento de login fallido - usuario: ${nombre_usuario}`);
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }

        // Verificar si está bloqueado
        if (usuario.bloqueado_hasta && usuario.bloqueado_hasta > new Date()) {
            return res.status(423).json({ 
                error: 'Usuario bloqueado temporalmente' 
            });
        }

        // Validar contraseña
        const valida = await usuario.validarContrasena(contrasena);

        if (!valida) {
            usuario.intentos_fallidos += 1;
            
            if (usuario.intentos_fallidos >= 5) {
                usuario.bloqueado_hasta = new Date(Date.now() + 30 * 60000);
            }
            
            await usuario.save();
            
            logger.warn(`Contraseña incorrecta - usuario: ${nombre_usuario}`);
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }

        // Resetear intentos fallidos
        usuario.intentos_fallidos = 0;
        usuario.bloqueado_hasta = null;
        usuario.ultimo_acceso = new Date();
        usuario.ultimo_ip = req.ip;
        await usuario.save();

        // Generar token
        const token = jwt.sign(
            { 
                id: usuario.id, 
                usuario: usuario.nombre_usuario,
                rol: usuario.rol 
            },
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn }
        );

    // logger.info(`Login exitoso - usuario: ${usuario.nombre_completo}`);
 // ✅ O usar solo en debug:
        if (process.env.DEBUG === 'true') {
            logger.debug(`Login exitoso - usuario: ${usuario.nombre_completo}`);
        }
        res.json({
            mensaje: 'Login exitoso',
            token,
            usuario: usuario.toJSON()
        });

    } catch (error) {
        logger.error('Error en login:', error);
        res.status(500).json({ 
            error: 'Error en el servidor' 
        });
    }
};

const verificarToken = async (req, res) => {
    try {
        // Si llegó aquí, el middleware de autenticación ya verificó el token
        res.json({ 
            valido: true, 
            usuario: req.usuario.toJSON() 
        });
    } catch (error) {
        logger.error('Error verificando token:', error);
        res.status(401).json({ 
            valido: false, 
            error: 'Token inválido' 
        });
    }
};

const cambiarContrasena = async (req, res) => {
    try {
        const { contrasena_actual, contrasena_nueva } = req.body;
        const usuario = req.usuario;

        const valida = await usuario.validarContrasena(contrasena_actual);
        
        if (!valida) {
            return res.status(401).json({ 
                error: 'Contraseña actual incorrecta' 
            });
        }

        usuario.contrasena_hash = contrasena_nueva;
        await usuario.save();

        logger.info(`Contraseña cambiada - usuario: ${usuario.nombre_usuario}`);

        res.json({ 
            mensaje: 'Contraseña actualizada correctamente' 
        });

    } catch (error) {
        logger.error('Error cambiando contraseña:', error);
        res.status(500).json({ 
            error: 'Error en el servidor' 
        });
    }
};

module.exports = {
    login,
    verificarToken,
    cambiarContrasena
};