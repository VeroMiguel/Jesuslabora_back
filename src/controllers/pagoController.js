const { Pago, Orden } = require('../models');
const { sequelize, Op } = require('../models');
const logger = require('../utils/logger');

const registrarPago = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        console.log('📝 [DEBUG] Body recibido:', JSON.stringify(req.body, null, 2));
        console.log('📝 [DEBUG] Usuario autenticado:', req.usuario?.id);
        
        const { orden_id, monto, metodo_pago, referencia, observaciones } = req.body;

        if (!req.usuario || !req.usuario.id) {
            console.log('❌ Usuario no autenticado');
            await transaction.rollback();
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        if (!orden_id || !monto || !metodo_pago) {
            console.log('❌ Datos faltantes:', { orden_id, monto, metodo_pago });
            await transaction.rollback();
            return res.status(400).json({ error: 'Faltan datos requeridos: orden_id, monto, metodo_pago' });
        }

        console.log(`📝 Buscando orden ID: ${orden_id}`);

        const orden = await Orden.findByPk(orden_id, { transaction });
        
        if (!orden) {
            console.log(`❌ Orden no encontrada: ${orden_id}`);
            await transaction.rollback();
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        console.log(`✅ Orden encontrada: ${orden.id_externo}, Total: ${orden.total}`);

        const pagosExistentes = await Pago.findAll({
            where: { orden_id },
            attributes: [[sequelize.fn('SUM', sequelize.col('monto')), 'totalPagado']],
            transaction
        });
        
        const totalPagadoActual = parseFloat(pagosExistentes[0]?.dataValues?.totalPagado || 0);
        const montoNumerico = parseFloat(monto);
        const nuevoTotalPagado = totalPagadoActual + montoNumerico;
        const totalOrden = parseFloat(orden.total);
        
        console.log(`💰 Total pagado actual: ${totalPagadoActual}, Nuevo monto: ${montoNumerico}, Nuevo total: ${nuevoTotalPagado}, Total orden: ${totalOrden}`);
        
        if (nuevoTotalPagado > totalOrden) {
            console.log(`❌ Monto excede saldo pendiente`);
            await transaction.rollback();
            return res.status(400).json({ 
                error: 'El monto excede el saldo pendiente',
                saldo_pendiente: (totalOrden - totalPagadoActual).toFixed(2)
            });
        }

        console.log(`📝 Creando pago para orden ${orden_id} con monto ${montoNumerico}`);
        
        const pago = await Pago.create({
            orden_id,
            monto: montoNumerico,
            metodo_pago,
            referencia: referencia || null,
            observaciones: observaciones || null,
            usuario_registro_id: req.usuario.id
        }, { transaction });

        console.log(`✅ Pago creado con ID: ${pago.id}`);

        let nuevoEstado = 'pendiente';
        if (nuevoTotalPagado >= totalOrden) {
            nuevoEstado = 'terminado';
        }

        await orden.update({ estado: nuevoEstado }, { transaction });
        console.log(`📝 Orden actualizada a estado: ${nuevoEstado}`);

        try {
            await sequelize.query(
                `INSERT INTO logs_actividad (usuario_id, accion, entidad_tipo, entidad_id, detalle, ip_direccion, creado_en) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                {
                    replacements: [
                        req.usuario.id,
                        'registrar_pago',
                        'pago',
                        pago.id,
                        JSON.stringify({ orden_id, monto: montoNumerico, metodo: metodo_pago }),
                        req.ip || req.headers['x-forwarded-for'] || 'unknown'
                    ],
                    transaction
                }
            );
            console.log(`✅ Log registrado`);
        } catch (logError) {
            console.error(`⚠️ Error registrando log (no crítico):`, logError.message);
        }

        await transaction.commit();

        console.log(`🎉 Pago registrado exitosamente - Orden: ${orden_id}, Monto: ${montoNumerico}`);

        res.status(201).json({
            mensaje: 'Pago registrado correctamente',
            pago: {
                id: pago.id,
                monto: pago.monto,
                metodo_pago: pago.metodo_pago,
                referencia: pago.referencia,
                creado_en: pago.createdAt
            },
            nuevo_estado: nuevoEstado,
            saldo_restante: (totalOrden - nuevoTotalPagado).toFixed(2)
        });

    } catch (error) {
        await transaction.rollback();
        console.error('❌ Error registrando pago - DETALLES:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({ error: 'Error al registrar pago', details: error.message });
    }
};

const obtenerPagosPorOrden = async (req, res) => {
    try {
        const { ordenId } = req.params;
        
        const pagos = await Pago.findAll({
            where: { orden_id: ordenId },
            order: [['creado_en', 'DESC']]
        });

        res.json(pagos);
    } catch (error) {
        logger.error('Error obteniendo pagos:', error);
        res.status(500).json({ error: 'Error al obtener pagos' });
    }
};

const eliminarPago = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const pago = await Pago.findByPk(id);

        if (!pago) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }

        const ordenId = pago.orden_id;
        
        await pago.destroy();

        const [result] = await sequelize.query(
            'SELECT COALESCE(SUM(monto), 0) as total FROM pagos WHERE orden_id = ?',
            { replacements: [ordenId] }
        );
        
        const totalPagado = parseFloat(result[0]?.total || 0);
        
        const orden = await Orden.findByPk(ordenId);
        
        if (orden) {
            let nuevoEstado = 'pendiente';
            if (totalPagado >= parseFloat(orden.total)) {
                nuevoEstado = 'terminado';
            }
            
            if (orden.estado !== nuevoEstado) {
                await orden.update({ estado: nuevoEstado });
                logger.info(`Orden ${ordenId} actualizada a estado: ${nuevoEstado} después de eliminar pago`);
            }
        }

        await sequelize.query(
            `INSERT INTO logs_actividad (usuario_id, accion, entidad_tipo, entidad_id, detalle, ip_direccion, creado_en) 
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            {
                replacements: [
                    req.usuario.id,
                    'eliminar_pago',
                    'pago',
                    id,
                    JSON.stringify({ orden_id: ordenId }),
                    req.ip || req.headers['x-forwarded-for'] || null
                ]
            }
        );

        logger.info(`Pago eliminado - ID: ${id}`);

        res.json({
            mensaje: 'Pago eliminado correctamente'
        });

    } catch (error) {
        logger.error('Error eliminando pago:', error);
        res.status(500).json({ error: 'Error al eliminar pago', details: error.message });
    }
};

// ✅ MÉTODO CORREGIDO - actualizarPago
const actualizarPago = async (req, res) => {
    try {
        const { id } = req.params;
        const { monto, metodo_pago, referencia } = req.body;

        // Validar que el monto sea un número válido
        if (!monto || isNaN(parseFloat(monto)) || parseFloat(monto) <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }

        const pago = await Pago.findByPk(id);
        
        if (!pago) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }

        // ✅ CORREGIDO: Verificar que la orden existe
        const orden = await Orden.findByPk(pago.orden_id);
        if (!orden) {
            return res.status(400).json({ error: 'La orden asociada no existe' });
        }

        // Calcular el total de otros pagos (excluyendo el actual)
        const [result] = await sequelize.query(
            'SELECT COALESCE(SUM(monto), 0) as total FROM pagos WHERE orden_id = ? AND id != ?',
            { replacements: [pago.orden_id, id] }
        );

        const totalOtrosPagos = parseFloat(result[0]?.total || 0);
        const nuevoTotalPagado = totalOtrosPagos + parseFloat(monto);
        const totalOrden = parseFloat(orden.total);

        // Validar que no exceda el total de la orden
        if (nuevoTotalPagado > totalOrden) {
            const maximoPermitido = totalOrden - totalOtrosPagos;
            return res.status(400).json({ 
                error: 'El monto total de pagos no puede exceder el total de la orden',
                maximoPermitido: maximoPermitido.toFixed(2)
            });
        }

        // Actualizar pago
        await pago.update({
            monto: parseFloat(monto),
            metodo_pago,
            referencia
        });

        // Actualizar estado de la orden
        let nuevoEstado = orden.estado;
        if (nuevoTotalPagado >= totalOrden) {
            nuevoEstado = 'terminado';
        } else if (orden.estado === 'terminado' && nuevoTotalPagado < totalOrden) {
            nuevoEstado = 'pendiente';
        }

        if (nuevoEstado !== orden.estado) {
            await orden.update({ estado: nuevoEstado });
        }

        // Registrar en log
        await sequelize.query(
            'INSERT INTO logs_actividad (usuario_id, accion, entidad_tipo, entidad_id, detalle, creado_en) VALUES (?, ?, ?, ?, ?, NOW())',
            {
                replacements: [
                    req.usuario.id,
                    'actualizar_pago',
                    'pago',
                    pago.id,
                    JSON.stringify({ 
                        orden_id: pago.orden_id, 
                        monto_anterior: pago.monto,
                        monto_nuevo: monto,
                        metodo: metodo_pago 
                    })
                ]
            }
        );

        logger.info(`Pago actualizado - ID: ${id}, Nuevo monto: ${monto}`);

        res.json({
            mensaje: 'Pago actualizado correctamente',
            pago,
            nuevo_estado: nuevoEstado
        });

    } catch (error) {
        logger.error('Error actualizando pago:', error);
        res.status(500).json({ error: 'Error al actualizar pago' });
    }
};

module.exports = {
    registrarPago,
    obtenerPagosPorOrden,
    eliminarPago,
    actualizarPago
};