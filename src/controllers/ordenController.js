// ordenController.js - VERSIÓN COMPLETA Y CORREGIDA
const { Orden, Doctor, Servicio, Pago, DetalleOrden, sequelize, Op } = require('../models');
const logger = require('../utils/logger');
const fileService = require('../services/fileService');

// ============================================
// MÉTODOS ACTUALIZADOS (CON DETALLES)
// ============================================

// Obtener órdenes (incluyendo detalles)
const obtenerOrdenes = async (req, res) => {
    try {
        const ordenes = await Orden.findAll({
            include: [
                { model: Doctor, as: 'doctor', attributes: ['id', 'nombre', 'telefono_whatsapp', 'logo_url'] },
                { model: DetalleOrden, as: 'detalles', include: [{ model: Servicio, as: 'servicio' }] },
                { model: Pago, as: 'pagos', required: false }
            ],
            order: [['fecha_registro', 'DESC']]
        });
        res.json(ordenes);
    } catch (error) {
        logger.error('Error obteniendo órdenes:', error);
        res.status(500).json({ error: 'Error al obtener órdenes' });
    }
};

// Obtener orden por ID (con detalles)
const obtenerOrdenPorId = async (req, res) => {
    try {
        const { id } = req.params;
        
        const orden = await Orden.findOne({
            where: { id: id },
            include: [
                { model: Doctor, as: 'doctor', attributes: ['id', 'nombre', 'telefono_whatsapp', 'logo_url'] },
                { model: DetalleOrden, as: 'detalles', include: [{ model: Servicio, as: 'servicio' }] },
                { model: Pago, as: 'pagos', required: false, order: [['creado_en', 'DESC']] }
            ]
        });
        
        if (!orden) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        // Calcular total pagado y saldo
        const totalPagado = orden.pagos?.reduce((sum, pago) => sum + Number(pago.monto), 0) || 0;
        const saldo = Number(orden.total) - totalPagado;
        
        res.json({
            ...orden.toJSON(),
            totalPagado,
            saldo
        });
    } catch (error) {
        logger.error('Error obteniendo orden por ID:', error);
        res.status(500).json({ error: 'Error al obtener la orden' });
    }
};

// CREAR ORDEN CON MÚLTIPLES SERVICIOS
const crearOrden = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const { detalles, doctor_id, pago_inicial, cliente_nombre, detalle_cliente, prioridad, metodo_pago } = req.body;
        
        // Validar detalles
        if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
            return res.status(400).json({ error: 'Debe agregar al menos un servicio' });
        }
        
        // Validar cada detalle
        for (const det of detalles) {
            if (!det.servicio_id || !det.precio_unitario || det.precio_unitario <= 0) {
                return res.status(400).json({ error: 'Cada servicio debe tener precio válido' });
            }
            if (!det.cantidad || det.cantidad < 1) {
                det.cantidad = 1;
            }
        }
        
        // Calcular total sumando subtotales
        let total = 0;
        for (const det of detalles) {
            total += det.cantidad * det.precio_unitario;
        }
        
        // Procesar imagen de referencia si existe
        let imagen_referencia_url = null;
        if (req.file) {
            imagen_referencia_url = await fileService.saveFile(req.file, 'ordenes');
        }
        
        // Crear orden
        const orden = await Orden.create({
            doctor_id,
            total: total,
            prioridad: prioridad || 'normal',
            cliente_nombre: cliente_nombre || null,
            detalle_cliente: detalle_cliente || null,
            usuario_creo_id: req.usuario.id,
            id_externo: `ORD-${Date.now()}`,
            imagen_referencia_url: imagen_referencia_url
        }, { transaction });
        
        // Crear detalles
        for (const det of detalles) {
            await DetalleOrden.create({
                orden_id: orden.id,
                servicio_id: det.servicio_id,
                cantidad: det.cantidad,
                precio_unitario: det.precio_unitario,
                fecha_limite: det.fecha_limite || null,
                hora_limite: det.hora_limite || null
            }, { transaction });
        }
        
        // Pago inicial
        if (pago_inicial && parseFloat(pago_inicial) > 0) {
            await Pago.create({
                orden_id: orden.id,
                monto: parseFloat(pago_inicial),
                metodo_pago: metodo_pago || 'efectivo',
                usuario_registro_id: req.usuario.id,
                referencia: 'Pago inicial'
            }, { transaction });
        }
        
        await transaction.commit();
        
        // Recargar orden con relaciones
        const ordenCompleta = await Orden.findByPk(orden.id, {
            include: [
                { model: Doctor, as: 'doctor', attributes: ['id', 'nombre', 'telefono_whatsapp', 'logo_url'] },
                { model: DetalleOrden, as: 'detalles', include: [{ model: Servicio, as: 'servicio' }] },
                { model: Pago, as: 'pagos', required: false }
            ]
        });
        
        logger.info(`Orden creada - ID: ${orden.id}, Servicios: ${detalles.length}`);
        
        res.status(201).json({
            mensaje: 'Orden creada correctamente',
            orden: ordenCompleta
        });
        
    } catch (error) {
        await transaction.rollback();
        logger.error('Error creando orden:', error);
        res.status(500).json({ error: 'Error al crear orden', details: error.message });
    }
};

// ACTUALIZAR ORDEN CON MÚLTIPLES SERVICIOS
const actualizarOrden = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const { id } = req.params;
        const orden = await Orden.findByPk(id);
        
        if (!orden) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        const { detalles, doctor_id, cliente_nombre, detalle_cliente, prioridad } = req.body;
        
        // Calcular nuevo total si vienen detalles
        let total = orden.total;
        if (detalles && Array.isArray(detalles) && detalles.length > 0) {
            total = 0;
            for (const det of detalles) {
                total += det.cantidad * det.precio_unitario;
            }
        }
        
        // Procesar imagen si se subió
        let imagen_referencia_url = orden.imagen_referencia_url;
        if (req.file) {
            if (orden.imagen_referencia_url) {
                await fileService.deleteFile(orden.imagen_referencia_url);
            }
            imagen_referencia_url = await fileService.saveFile(req.file, 'ordenes');
        }
        
        // Actualizar orden
        await orden.update({
            doctor_id: doctor_id || orden.doctor_id,
            total: total,
            prioridad: prioridad || orden.prioridad,
            cliente_nombre: cliente_nombre !== undefined ? cliente_nombre : orden.cliente_nombre,
            detalle_cliente: detalle_cliente !== undefined ? detalle_cliente : orden.detalle_cliente,
            imagen_referencia_url: imagen_referencia_url
        }, { transaction });
        
        // Actualizar detalles (reemplazar todos)
        if (detalles && Array.isArray(detalles) && detalles.length > 0) {
            // Eliminar detalles existentes
            await DetalleOrden.destroy({ where: { orden_id: id }, transaction });
            
            // Crear nuevos detalles
            for (const det of detalles) {
                await DetalleOrden.create({
                    orden_id: id,
                    servicio_id: det.servicio_id,
                    cantidad: det.cantidad || 1,
                    precio_unitario: det.precio_unitario,
                    fecha_limite: det.fecha_limite || null,
                    hora_limite: det.hora_limite || null
                }, { transaction });
            }
        }
        
        await transaction.commit();
        
        // Recargar orden actualizada
        const ordenActualizada = await Orden.findByPk(id, {
            include: [
                { model: Doctor, as: 'doctor' },
                { model: DetalleOrden, as: 'detalles', include: [{ model: Servicio, as: 'servicio' }] },
                { model: Pago, as: 'pagos' }
            ]
        });
        
        logger.info(`Orden actualizada - ID: ${id}`);
        
        res.json({
            mensaje: 'Orden actualizada correctamente',
            orden: ordenActualizada
        });
        
    } catch (error) {
        await transaction.rollback();
        logger.error('Error actualizando orden:', error);
        res.status(500).json({ error: 'Error al actualizar orden', details: error.message });
    }
};

// Eliminar orden
const eliminarOrden = async (req, res) => {
    try {
        const { id } = req.params;
        const orden = await Orden.findByPk(id);
        
        if (!orden) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        if (orden.imagen_referencia_url) {
            await fileService.deleteFile(orden.imagen_referencia_url);
        }
        
        // Los detalles se eliminan automáticamente por CASCADE
        await orden.destroy();
        
        logger.info(`Orden eliminada - ID: ${id}`);
        res.json({ mensaje: 'Orden eliminada correctamente' });
        
    } catch (error) {
        logger.error('Error eliminando orden:', error);
        res.status(500).json({ error: 'Error al eliminar orden' });
    }
};

// ============================================
// MÉTODOS EXISTENTES (SIN CAMBIOS - SOLO COPIAR)
// ============================================

const obtenerEstadisticas = async (req, res) => {
    try {
        const ordenesActivas = await Orden.count({ where: { estado: 'pendiente' } });
        
        const ordenesVencidas = await sequelize.query(`
            SELECT COUNT(*) as total FROM ordenes o
            WHERE o.estado = 'pendiente' 
              AND o.fecha_limite <= CURDATE()
              AND (o.total - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.orden_id = o.id), 0)) > 0
        `, { type: sequelize.QueryTypes.SELECT });
        
        const ordenesTerminadas = await Orden.count({ where: { estado: 'terminado' } });
        
        const cajaHoyResult = await sequelize.query(`
            SELECT COALESCE(SUM(monto), 0) as total 
            FROM pagos 
            WHERE DATE(creado_en) = CURDATE()
        `, { type: sequelize.QueryTypes.SELECT });
        const cajaHoy = parseFloat(cajaHoyResult[0]?.total || 0);
        
        const cajaSemanaResult = await sequelize.query(`
            SELECT COALESCE(SUM(monto), 0) as total 
            FROM pagos 
            WHERE creado_en >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        `, { type: sequelize.QueryTypes.SELECT });
        const cajaSemana = parseFloat(cajaSemanaResult[0]?.total || 0);
        
        res.json({
            ordenes_activas: ordenesActivas,
            ordenes_vencidas: ordenesVencidas[0]?.total || 0,
            ordenes_terminadas: ordenesTerminadas,
            caja_hoy: cajaHoy,
            caja_semana: cajaSemana
        });
    } catch (error) {
        logger.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas', details: error.message });
    }
};

const obtenerIngresosMensuales = async (req, res) => {
    try {
        const ingresos = await sequelize.query(`
            SELECT 
                DATE_FORMAT(creado_en, '%Y-%m') as mes,
                MONTH(creado_en) as mes_numero,
                YEAR(creado_en) as año,
                SUM(monto) as total
            FROM pagos
            WHERE creado_en >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY YEAR(creado_en), MONTH(creado_en), DATE_FORMAT(creado_en, '%Y-%m')
            ORDER BY año ASC, mes_numero ASC
        `, { type: sequelize.QueryTypes.SELECT });

        const nombresMeses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        
        const resultado = [];
        const hoy = new Date();
        
        for (let i = 5; i >= 0; i--) {
            const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
            const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
            const mesNombre = nombresMeses[fecha.getMonth()];
            
            const ingreso = ingresos.find(i => i.mes === mesKey);
            
            resultado.push({
                mes: mesNombre,
                mes_completo: mesKey,
                total: ingreso ? parseFloat(ingreso.total) : 0
            });
        }

        res.json(resultado);
    } catch (error) {
        logger.error('Error obteniendo ingresos mensuales:', error);
        res.status(500).json({ error: 'Error al obtener ingresos mensuales' });
    }
};

const obtenerFechaServidor = (req, res) => {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    res.json({ fecha: `${anio}-${mes}-${dia}` });
};

const obtenerFechaHoraServidor = (req, res) => {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    const horas = String(ahora.getHours()).padStart(2, '0');
    const minutos = String(ahora.getMinutes()).padStart(2, '0');
    const segundos = String(ahora.getSeconds()).padStart(2, '0');
    
    res.json({
        fecha: `${anio}-${mes}-${dia}`,
        hora: `${horas}:${minutos}:${segundos}`,
        fecha_hora: `${anio}-${mes}-${dia} ${horas}:${minutos}:${segundos}`,
        timestamp: ahora.getTime(),
        timezone: 'America/Lima',
        hoy: `${anio}-${mes}-${dia}`,
        ahora_militar: `${horas}:${minutos}`
    });
};

const actualizarImagenReferencia = async (req, res) => {
    try {
        const { id } = req.params;
        const orden = await Orden.findByPk(id);

        if (!orden) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó ninguna imagen' });
        }

        const imagen_url = await fileService.saveFile(req.file, 'ordenes');
        
        if (orden.imagen_referencia_url) {
            await fileService.deleteFile(orden.imagen_referencia_url);
        }
        
        orden.imagen_referencia_url = imagen_url;
        await orden.save();

        res.json({
            mensaje: 'Imagen de referencia actualizada correctamente',
            imagen_url: orden.imagen_referencia_url
        });
    } catch (error) {
        logger.error('Error actualizando imagen de referencia:', error);
        res.status(500).json({ error: 'Error al actualizar la imagen: ' + error.message });
    }
};

// ============================================
// NUEVO MÉTODO PARA EL CALENDARIO
// ============================================

const obtenerOrdenesConFiltrosAvanzados = async (req, res) => {
    try {
        const { doctor_id, fecha_inicio, fecha_fin, tipo_fecha, estado } = req.query;
        
        const where = {};
        
        if (doctor_id && doctor_id !== 'todos') {
            where.doctor_id = doctor_id;
        }
        
        if (estado && estado !== 'todos') {
            where.estado = estado;
        }
        
        if (fecha_inicio && fecha_fin) {
            const campoFecha = tipo_fecha === 'limite' ? 'fecha_limite' : 'fecha_registro';
            where[campoFecha] = {
                [Op.between]: [fecha_inicio, fecha_fin]
            };
        }
        
        const ordenes = await Orden.findAll({
            where,
            include: [
                { model: Doctor, as: 'doctor', attributes: ['id', 'nombre', 'telefono_whatsapp', 'logo_url'] },
                { model: DetalleOrden, as: 'detalles', include: [{ model: Servicio, as: 'servicio' }] },
                { model: Pago, as: 'pagos', required: false }
            ],
            order: [[tipo_fecha === 'limite' ? 'fecha_limite' : 'fecha_registro', 'ASC']]
        });
        
        const ordenesConSaldo = ordenes.map(orden => {
            const totalPagado = orden.pagos?.reduce((sum, pago) => sum + Number(pago.monto), 0) || 0;
            const saldo = Number(orden.total) - totalPagado;
            return {
                ...orden.toJSON(),
                saldo,
                totalPagado
            };
        });
        
        res.json(ordenesConSaldo);
    } catch (error) {
        logger.error('Error en obtenerOrdenesConFiltrosAvanzados:', error);
        res.status(500).json({ error: 'Error al obtener órdenes', details: error.message });
    }
};

// ============================================
// EXPORTACIÓN
// ============================================

module.exports = {
    obtenerOrdenes,
    obtenerOrdenPorId,
    crearOrden,
    actualizarOrden,
    eliminarOrden,
    obtenerEstadisticas,
    obtenerIngresosMensuales,
    obtenerFechaServidor,
    obtenerFechaHoraServidor,
    actualizarImagenReferencia,
    obtenerOrdenesConFiltrosAvanzados
};