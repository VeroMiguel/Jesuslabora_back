const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const { Orden, Doctor, Servicio, TokenFCM } = require('../models');
const admin = require('../config/firebase-admin');
const { Op } = require('sequelize'); // ✅ AGREGAR ESTA LÍNEA

// Registrar token FCM - VERSIÓN MEJORADA CON LIMPIEZA AUTOMÁTICA
router.post('/registrar-token', autenticar, async (req, res) => {
    try {
        const { token, dispositivo, plataforma } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Token no proporcionado' });
        }
        
        // ✅ 1. Desactivar TODOS los tokens del usuario
        await TokenFCM.update(
            { activo: false },
            { where: { usuario_id: req.usuario.id, activo: true } }
        );
        
        // ✅ 2. Eliminar tokens inactivos con más de 30 días
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - 30);
        const eliminados = await TokenFCM.destroy({
            where: {
                usuario_id: req.usuario.id,
                activo: false,
                actualizado_en: { [Op.lt]: fechaLimite }
            }
        });
        
        if (eliminados > 0) {
            console.log(`🗑️ Eliminados ${eliminados} tokens antiguos del usuario ${req.usuario.id}`);
        }
        
        // ✅ 3. Buscar si el token ya existe (para reactivarlo)
        let tokenRecord = await TokenFCM.findOne({ where: { token } });
        
        if (tokenRecord) {
            await tokenRecord.update({
                usuario_id: req.usuario.id,
                dispositivo: dispositivo || req.headers['user-agent'],
                plataforma: plataforma || 'web',
                ultimo_uso: new Date(),
                activo: true
            });
            console.log(`✅ Token FCM reactivado para usuario ${req.usuario.id}`);
        } else {
            await TokenFCM.create({
                token,
                usuario_id: req.usuario.id,
                dispositivo: dispositivo || req.headers['user-agent'],
                plataforma: plataforma || 'web',
                ultimo_uso: new Date(),
                activo: true
            });
            console.log(`✅ Nuevo token FCM creado para usuario ${req.usuario.id}`);
        }
        
        // ✅ 4. Limpieza global de tokens muy antiguos (más de 90 días)
        const fechaLimiteGlobal = new Date();
        fechaLimiteGlobal.setDate(fechaLimiteGlobal.getDate() - 90);
        const globalEliminados = await TokenFCM.destroy({
            where: {
                activo: false,
                actualizado_en: { [Op.lt]: fechaLimiteGlobal }
            }
        });
        
        if (globalEliminados > 0) {
            console.log(`🗑️ Limpieza global: ${globalEliminados} tokens eliminados`);
        }
        
        res.json({ success: true, message: 'Token registrado correctamente' });
    } catch (error) {
        console.error('Error registrando token:', error);
        res.status(500).json({ error: 'Error registrando token' });
    }
});

// Eliminar token FCM (logout)
router.delete('/eliminar-token', autenticar, async (req, res) => {
    try {
        const { token } = req.body;
        await TokenFCM.destroy({ where: { token } });
        console.log(`🗑️ Token FCM eliminado`);
        res.json({ success: true, message: 'Token eliminado' });
    } catch (error) {
        console.error('Error eliminando token:', error);
        res.status(500).json({ error: 'Error eliminando token' });
    }
});

// Enviar prueba de notificación push
router.post('/test', autenticar, async (req, res) => {
    try {
        const tokens = await TokenFCM.findAll({
            where: { usuario_id: req.usuario.id, activo: true }
        });
        
        if (tokens.length === 0) {
            return res.json({ success: false, message: 'No hay tokens FCM registrados' });
        }
        
        for (const tokenRecord of tokens) {
            const message = {
                token: tokenRecord.token,
                notification: {
                    title: '🔔 Notificación de prueba',
                    body: 'Esta es una notificación push desde el servidor',
                    icon: '/favicon.ico'
                },
                data: { url: '/dashboard' }
            };
            await admin.messaging().send(message);
        }
        
        res.json({ success: true, message: 'Notificación de prueba enviada' });
    } catch (error) {
        console.error('Error enviando notificación de prueba:', error);
        res.status(500).json({ error: 'Error enviando notificación' });
    }
});

// Programar notificación push para una orden
router.post('/programar', autenticar, async (req, res) => {
    try {
        const { ordenId, minutosAntes } = req.body;
        
        console.log(`📨 [DEBUG] Solicitud programar push: ordenId=${ordenId}, minutosAntes=${minutosAntes}`);
        
        // Buscar la orden con sus relaciones
        const orden = await Orden.findByPk(ordenId, {
            include: [
                { model: Doctor, as: 'doctor', attributes: ['nombre'] },
                { model: Servicio, as: 'servicio', attributes: ['nombre'] }
            ]
        });
        
        if (!orden) {
            console.log(`❌ Orden no encontrada: ${ordenId}`);
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        console.log(`📦 Orden encontrada: ${orden.id_externo}, fecha_limite: ${orden.fecha_limite}, hora_limite: ${orden.hora_limite}`);
        
        // Calcular la fecha de disparo
        const fechaHora = new Date(`${orden.fecha_limite}T${orden.hora_limite || '08:00'}`);
        const fechaDisparo = new Date(fechaHora.getTime() - minutosAntes * 60000);
        const ahora = new Date();
        const delay = fechaDisparo.getTime() - ahora.getTime();
        
        console.log(`⏰ Calculando delay: ahora=${ahora.toISOString()}, fechaDisparo=${fechaDisparo.toISOString()}, delay=${delay}ms (${Math.round(delay / 60000)} min)`);
        
        if (delay > 0) {
            // Programar el envío
            setTimeout(async () => {
                console.log(`🔔 [TIMER] Enviando notificación push para orden ${orden.id_externo} (${minutosAntes} min antes)`);
                
                try {
                    // Obtener tokens del usuario que creó la orden
                    const tokens = await TokenFCM.findAll({
                        where: { usuario_id: orden.usuario_creo_id, activo: true }
                    });
                    
                    if (tokens.length === 0) {
                        console.log(`⚠️ No hay tokens FCM para usuario ${orden.usuario_creo_id}`);
                        return;
                    }
                    
                    // Enviar notificación a cada token
                    for (const tokenRecord of tokens) {
                        let tituloDetallado, cuerpoDetallado;
                        
                        const doctorNombre = orden.doctor?.nombre || 'Doctor';
                        const servicioNombre = orden.servicio?.nombre || 'Servicio';
                        const clienteNombre = orden.cliente_nombre || 'Sin cliente';
                        
                        if (minutosAntes === 0) {
                            tituloDetallado = `📋 ORDEN VENCE AHORA`;
                            cuerpoDetallado = `${orden.id_externo}\n👨‍⚕️ ${doctorNombre}\n🦷 ${servicioNombre}\n👤 ${clienteNombre}`;
                        } else {
                            tituloDetallado = `⚠️ ORDEN POR VENCER`;
                            cuerpoDetallado = `${orden.id_externo}\n⏰ ${minutosAntes} minutos\n👨‍⚕️ ${doctorNombre}\n🦷 ${servicioNombre}\n👤 ${clienteNombre}`;
                        }
                        
                        const message = {
                            token: tokenRecord.token,
                            android: {
                                priority: 'high',
                                notification: {
                                    title: tituloDetallado,
                                    body: cuerpoDetallado,
                                    icon: 'ic_notification',
                                    color: '#6366f1',
                                    sound: 'default',
                                    channelId: 'ordenes_channel',
                                    clickAction: 'OPEN_ACTIVITY'
                                }
                            },
                            data: {
                                ordenId: orden.id.toString(),
                                url: `/ordenes/${orden.id}`,
                                click_action: `/ordenes/${orden.id}`,
                                titulo_detallado: tituloDetallado,
                                cuerpo_detallado: cuerpoDetallado
                            }
                        };
                        
                        console.log(`📨 Enviando push Android a token: ${tokenRecord.token.substring(0, 20)}...`);
                        
                        try {
                            const response = await admin.messaging().send(message);
                            console.log(`✅ Notificación push enviada: ${response.messageId || 'OK'}`);
                        } catch (sendError) {
                            console.error(`❌ Error enviando push:`, sendError.message);
                            if (sendError.code === 'messaging/registration-token-not-registered') {
                                await tokenRecord.update({ activo: false });
                                console.log(`⚠️ Token inválido desactivado`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`❌ Error enviando notificación push:`, error);
                }
            }, delay);
            
            console.log(`⏰ Notificación push PROGRAMADA para orden ${orden.id_externo} en ${Math.round(delay / 60000)} min`);
            
            res.json({ success: true, message: `Notificación programada para ${minutosAntes} min antes`, delay: Math.round(delay / 60000) });
        } else {
            console.log(`⚠️ No se programó notificación: delay no positivo (${delay}ms)`);
            res.json({ success: false, message: 'Fecha ya pasada, no se programó notificación' });
        }
    } catch (error) {
        console.error('❌ Error programando notificación:', error);
        res.status(500).json({ error: 'Error programando notificación', details: error.message });
    }
});

module.exports = router;