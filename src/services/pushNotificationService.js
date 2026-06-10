const admin = require('../config/firebase-admin');
const { TokenFCM, Orden, Doctor, Servicio } = require('../models');
const logger = require('../utils/logger');

class PushNotificationService {
    
    /**
     * Registrar token FCM de un usuario
     */
    async registrarToken(usuarioId, token, dispositivo, plataforma) {
        try {
            // Buscar si el token ya existe
            let tokenExistente = await TokenFCM.findOne({ where: { token } });
            
            if (tokenExistente) {
                // Actualizar último uso
                await tokenExistente.update({
                    ultimo_uso: new Date(),
                    dispositivo,
                    plataforma,
                    activo: true
                });
            } else {
                // Crear nuevo token
                await TokenFCM.create({
                    token,
                    usuario_id: usuarioId,
                    dispositivo,
                    plataforma,
                    ultimo_uso: new Date()
                });
            }
            logger.info(`✅ Token FCM registrado para usuario ${usuarioId}`);
            return true;
        } catch (error) {
            logger.error('Error registrando token FCM:', error);
            return false;
        }
    }
    
    /**
     * Eliminar token FCM (logout o token inválido)
     */
    async eliminarToken(token) {
        try {
            await TokenFCM.destroy({ where: { token } });
            logger.info(`🗑️ Token FCM eliminado`);
            return true;
        } catch (error) {
            logger.error('Error eliminando token:', error);
            return false;
        }
    }
    
    /**
     * Enviar notificación push a un usuario específico
     */
    async enviarNotificacionAUsuario(usuarioId, titulo, cuerpo, datos = {}) {
        try {
            const tokens = await TokenFCM.findAll({
                where: { usuario_id: usuarioId, activo: true }
            });
            
            if (tokens.length === 0) {
                logger.warn(`⚠️ Usuario ${usuarioId} no tiene tokens FCM registrados`);
                return false;
            }
            
            const resultados = [];
            for (const tokenRecord of tokens) {
                try {
                    const message = {
                        token: tokenRecord.token,
                        notification: {
                            title: titulo,
                            body: cuerpo,
                            icon: '/favicon.ico',
                            badge: '/favicon.ico'
                        },
                        data: {
                            ...datos,
                            click_action: datos.url || '/ordenes',
                            timestamp: Date.now().toString()
                        },
                        android: {
                            priority: 'high',
                            notification: {
                                sound: 'default',
                                vibrate: [200, 100, 200],
                                channelId: 'ordenes_channel'
                            }
                        },
                        apns: {
                            payload: {
                                aps: {
                                    sound: 'default',
                                    badge: 1
                                }
                            }
                        },
                        webpush: {
                            headers: {
                                Urgency: 'high'
                            },
                            notification: {
                                vibrate: [200, 100, 200],
                                actions: [
                                    { action: 'ver', title: 'Ver orden' },
                                    { action: 'cerrar', title: 'Cerrar' }
                                ]
                            }
                        }
                    };
                    
                    const response = await admin.messaging().send(message);
                    resultados.push({ token: tokenRecord.token, success: true, response });
                    logger.info(`📨 Notificación enviada a token: ${tokenRecord.token.substring(0, 20)}...`);
                } catch (error) {
                    // Si el token es inválido, desactivarlo
                    if (error.code === 'messaging/registration-token-not-registered') {
                        await tokenRecord.update({ activo: false });
                        logger.warn(`⚠️ Token inválido desactivado: ${tokenRecord.token.substring(0, 20)}...`);
                    }
                    resultados.push({ token: tokenRecord.token, success: false, error: error.message });
                }
            }
            
            return resultados;
        } catch (error) {
            logger.error('Error enviando notificación push:', error);
            return false;
        }
    }
    
    /**
     * Enviar notificación de orden por vencer
     */
    async notificarOrdenPorVencer(ordenId, minutosAntes = 0) {
        try {
            const orden = await Orden.findByPk(ordenId, {
                include: [
                    { model: Doctor, as: 'doctor', attributes: ['nombre'] },
                    { model: Servicio, as: 'servicio', attributes: ['nombre'] }
                ]
            });
            
            if (!orden || orden.estado !== 'pendiente') return;
            
            let titulo, cuerpo;
            if (minutosAntes === 0) {
                titulo = `📋 Orden ${orden.id_externo} — ¡Hora límite!`;
                cuerpo = `⏰ Vence AHORA: ${orden.doctor?.nombre} — ${orden.servicio?.nombre}`;
            } else {
                titulo = `⚠️ Orden ${orden.id_externo} — Vence en ${minutosAntes} min`;
                cuerpo = `${orden.doctor?.nombre} — ${orden.servicio?.nombre}`;
            }
            
            await this.enviarNotificacionAUsuario(
                orden.usuario_creo_id,
                titulo,
                cuerpo,
                { ordenId: orden.id.toString(), url: `/ordenes/${orden.id}` }
            );
            
            logger.info(`📨 Notificación push enviada para orden ${orden.id_externo} (${minutosAntes} min antes)`);
        } catch (error) {
            logger.error('Error enviando notificación de orden:', error);
        }
    }
    
    /**
     * Programar notificaciones push para una orden (usando setTimeout en backend)
     */
    async programarNotificacionPush(orden, minutosAntes) {
        const fechaHora = new Date(`${orden.fecha_limite}T${orden.hora_limite || '08:00'}`);
        const fechaDisparo = new Date(fechaHora.getTime() - minutosAntes * 60000);
        const ahora = new Date();
        const delay = fechaDisparo.getTime() - ahora.getTime();
        
        if (delay > 0) {
            setTimeout(async () => {
                await this.notificarOrdenPorVencer(orden.id, minutosAntes);
            }, delay);
            logger.info(`⏰ Notificación push programada para orden ${orden.id_externo} en ${Math.round(delay / 60000)} min`);
        }
    }
}

module.exports = new PushNotificationService();