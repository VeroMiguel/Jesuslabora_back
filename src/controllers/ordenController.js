// ordenController.js - VERSIÓN COMPLETA Y CORREGIDA
const { Orden, Doctor, Servicio, Pago, DetalleOrden, sequelize } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const fileService = require('../services/fileService');

// ============================================
// FUNCIÓN AUXILIAR - Generar código de paciente
// ============================================
const generarCodigoPaciente = (nombre, numero) => {
    const prefijo = nombre ? nombre.substring(0, 3).toUpperCase() : 'PAC';
    const sufijo = numero ? String(numero).padStart(4, '0') : String(Math.floor(1000 + Math.random() * 9000));
    return `${prefijo}-${sufijo}`;
};

// ============================================
// MÉTODOS PRINCIPALES
// ============================================

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

// ============================================
// CREAR ORDEN - CON GENERACIÓN DE CÓDIGO
// ============================================
const crearOrden = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const { detalles, doctor_id, pago_inicial, cliente_nombre, cliente_codigo, detalle_cliente, prioridad, metodo_pago } = req.body;
        
        if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
            return res.status(400).json({ error: 'Debe agregar al menos un servicio' });
        }
        
        for (const det of detalles) {
            if (!det.servicio_id || !det.precio_unitario || det.precio_unitario <= 0) {
                return res.status(400).json({ error: 'Cada servicio debe tener precio válido' });
            }
            if (!det.cantidad || det.cantidad < 1) {
                det.cantidad = 1;
            }
        }
        
        let total = 0;
        for (const det of detalles) {
            total += det.cantidad * det.precio_unitario;
        }
        
        let imagen_referencia_url = null;
        if (req.file) {
            imagen_referencia_url = await fileService.saveFile(req.file, 'ordenes');
        }
        
        // ✅ GENERAR CÓDIGO DE PACIENTE - Cliente único
        let clienteCodigo = cliente_codigo || null;
        if (cliente_nombre && !clienteCodigo) {
            const ultimoCodigo = await Orden.findOne({
                where: { 
                    cliente_nombre: cliente_nombre,
                    cliente_codigo: { [Op.ne]: null }
                },
                order: [['id', 'DESC']],
                transaction
            });
            
            let numero = 1;
            if (ultimoCodigo && ultimoCodigo.cliente_codigo) {
                const partes = ultimoCodigo.cliente_codigo.split('-');
                if (partes.length === 2) {
                    const num = parseInt(partes[1]);
                    if (!isNaN(num)) numero = num + 1;
                }
            }
            clienteCodigo = generarCodigoPaciente(cliente_nombre, numero);
        }
        
        // ✅ GENERAR CÓDIGO DE PACIENTE - Por servicio (clientes diferentes)
        for (let i = 0; i < detalles.length; i++) {
            const det = detalles[i];
            if (det.cliente_nombre && !det.cliente_codigo) {
                const ultimoCodigo = await DetalleOrden.findOne({
                    where: { 
                        cliente_nombre: det.cliente_nombre,
                        cliente_codigo: { [Op.ne]: null }
                    },
                    order: [['id', 'DESC']],
                    transaction
                });
                
                let numero = 1;
                if (ultimoCodigo && ultimoCodigo.cliente_codigo) {
                    const partes = ultimoCodigo.cliente_codigo.split('-');
                    if (partes.length === 2) {
                        const num = parseInt(partes[1]);
                        if (!isNaN(num)) numero = num + 1;
                    }
                }
                det.cliente_codigo = generarCodigoPaciente(det.cliente_nombre, numero);
            }
        }
        
        // ✅ Crear orden
        const orden = await Orden.create({
            doctor_id,
            total: total,
            prioridad: prioridad || 'normal',
            cliente_nombre: cliente_nombre || null,
            cliente_codigo: clienteCodigo,
            detalle_cliente: detalle_cliente || null,
            usuario_creo_id: req.usuario.id,
            id_externo: `ORD-${Date.now()}`,
            imagen_referencia_url: imagen_referencia_url
        }, { transaction });
        
        // ✅ Crear detalles
        for (let i = 0; i < detalles.length; i++) {
            const det = detalles[i];
            await DetalleOrden.create({
                orden_id: orden.id,
                servicio_id: det.servicio_id,
                cantidad: det.cantidad || 1,
                precio_unitario: det.precio_unitario,
                fecha_limite: det.fecha_limite || null,
                hora_limite: det.hora_limite || null,
                cliente_nombre: det.cliente_nombre || null,
                cliente_codigo: det.cliente_codigo || null,
                detalle_cliente: det.detalle_cliente || null,
                orden: i
            }, { transaction });
        }
        
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

// ============================================
// ACTUALIZAR ORDEN - CON cliente_codigo
// ============================================
const actualizarOrden = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const { id } = req.params;
        const orden = await Orden.findByPk(id, {
            include: [{ model: DetalleOrden, as: 'detalles' }]
        });
        
        if (!orden) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        const { detalles, doctor_id, cliente_nombre, cliente_codigo, detalle_cliente, prioridad, pago_inicial } = req.body;
        
        const detallesAntiguos = orden.detalles || [];
        
        let total = 0;
        if (detalles && Array.isArray(detalles) && detalles.length > 0) {
            for (const det of detalles) {
                const precio = Number(det.precio_unitario) || 0;
                total += precio;
            }
        } else {
            total = orden.total;
        }
        
        await orden.update({
            doctor_id: doctor_id || orden.doctor_id,
            total: total,
            prioridad: prioridad || orden.prioridad,
            cliente_nombre: cliente_nombre !== undefined ? cliente_nombre : orden.cliente_nombre,
            cliente_codigo: cliente_codigo !== undefined ? cliente_codigo : orden.cliente_codigo,
            detalle_cliente: detalle_cliente !== undefined ? detalle_cliente : orden.detalle_cliente,
        }, { transaction });
        
        if (detalles && Array.isArray(detalles) && detalles.length > 0) {
            const nuevosServicioIds = detalles.map(d => d.servicio_id);
            const detallesAEliminar = detallesAntiguos.filter(det => !nuevosServicioIds.includes(det.servicio_id));
            
            for (const det of detallesAEliminar) {
                if (det.imagen_referencia_url) {
                    await fileService.deleteFile(det.imagen_referencia_url);
                }
                await det.destroy({ transaction });
            }
            
            for (let i = 0; i < detalles.length; i++) {
                const det = detalles[i];
                const detalleExistente = detallesAntiguos.find(d => d.servicio_id === det.servicio_id);
                
                let imagenUrl = det.imagen_referencia_url || null;
                if (!imagenUrl && detalleExistente?.imagen_referencia_url) {
                    imagenUrl = detalleExistente.imagen_referencia_url;
                }
                
                if (detalleExistente) {
                    await detalleExistente.update({
                        servicio_id: det.servicio_id,
                        cantidad: det.cantidad || 1,
                        precio_unitario: det.precio_unitario,
                        fecha_limite: det.fecha_limite || null,
                        hora_limite: det.hora_limite || null,
                        cliente_nombre: det.cliente_nombre || null,
                        cliente_codigo: det.cliente_codigo || null,
                        detalle_cliente: det.detalle_cliente || null,
                        imagen_referencia_url: imagenUrl,
                        orden: i
                    }, { transaction });
                } else {
                    await DetalleOrden.create({
                        orden_id: id,
                        servicio_id: det.servicio_id,
                        cantidad: det.cantidad || 1,
                        precio_unitario: det.precio_unitario,
                        fecha_limite: det.fecha_limite || null,
                        hora_limite: det.hora_limite || null,
                        cliente_nombre: det.cliente_nombre || null,
                        cliente_codigo: det.cliente_codigo || null,
                        detalle_cliente: det.detalle_cliente || null,
                        imagen_referencia_url: imagenUrl,
                        orden: i
                    }, { transaction });
                }
            }
        }
        
        await transaction.commit();
        
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
        
        await orden.destroy();
        
        logger.info(`Orden eliminada - ID: ${id}`);
        res.json({ mensaje: 'Orden eliminada correctamente' });
        
    } catch (error) {
        logger.error('Error eliminando orden:', error);
        res.status(500).json({ error: 'Error al eliminar orden' });
    }
};

// ============================================
// MÉTODOS DE ESTADÍSTICAS
// ============================================

const obtenerEstadisticas = async (req, res) => {
    try {
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
        const ordenesActivas = await sequelize.query(`
            SELECT COUNT(DISTINCT o.id) as total
            FROM ordenes o
            WHERE o.estado = 'pendiente'
            AND (o.total - COALESCE((
                SELECT SUM(p.monto) 
                FROM pagos p 
                WHERE p.orden_id = o.id
            ), 0)) > 0
        `, { type: sequelize.QueryTypes.SELECT });
        
        const ordenesVencidas = await sequelize.query(`
            SELECT COUNT(DISTINCT o.id) as total
            FROM ordenes o
            JOIN detalles_orden do ON o.id = do.orden_id
            WHERE o.estado = 'pendiente'
            AND (o.total - COALESCE((
                SELECT SUM(p.monto) 
                FROM pagos p 
                WHERE p.orden_id = o.id
            ), 0)) > 0
            AND (
                do.fecha_limite < :fechaActual
                OR (do.fecha_limite = :fechaActual AND do.hora_limite <= :horaActual)
            )
        `, { 
            replacements: { fechaActual, horaActual },
            type: sequelize.QueryTypes.SELECT 
        });
        
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
        
        const result = {
            ordenes_activas: parseInt(ordenesActivas[0]?.total) || 0,
            ordenes_vencidas: parseInt(ordenesVencidas[0]?.total) || 0,
            ordenes_terminadas: ordenesTerminadas,
            caja_hoy: cajaHoy,
            caja_semana: cajaSemana
        };
        
        res.json(result);
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

// ============================================
// MÉTODOS DE FECHA SERVIDOR
// ============================================

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

// ============================================
// IMÁGENES DE REFERENCIA
// ============================================

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
// CALENDARIO - FILTROS AVANZADOS
// ============================================

const obtenerOrdenesConFiltrosAvanzados = async (req, res) => {
    try {
        const { doctor_id, fecha_inicio, fecha_fin, tipo_fecha, estado } = req.query;
        
        const where = {};
        
        if (doctor_id && doctor_id !== 'todos') {
            where.doctor_id = parseInt(doctor_id);
        }
        
        if (estado && estado !== 'todos') {
            where.estado = estado;
        }
        
        const includeOptions = [
            { model: Doctor, as: 'doctor', attributes: ['id', 'nombre', 'telefono_whatsapp', 'logo_url'] },
            { model: DetalleOrden, as: 'detalles', include: [{ model: Servicio, as: 'servicio' }] },
            { model: Pago, as: 'pagos', required: false }
        ];
        
        if (fecha_inicio && fecha_fin && tipo_fecha === 'limite') {
            includeOptions[1].where = {
                fecha_limite: {
                    [Op.between]: [fecha_inicio, fecha_fin]
                }
            };
        }
        
        let ordenes = await Orden.findAll({
            where,
            include: includeOptions,
            order: [['fecha_registro', 'DESC']]
        });
        
        if (fecha_inicio && fecha_fin && tipo_fecha === 'registro') {
            const fechaInicioDate = new Date(fecha_inicio);
            const fechaFinDate = new Date(fecha_fin);
            
            ordenes = ordenes.filter(orden => {
                let fechaRegistro = orden.fecha_registro;
                
                if (fechaRegistro instanceof Date) {
                    fechaRegistro = fechaRegistro.toISOString().split('T')[0];
                } else if (typeof fechaRegistro === 'string') {
                    fechaRegistro = fechaRegistro.split('T')[0];
                }
                
                if (!fechaRegistro) return false;
                
                const fechaRegistroDate = new Date(fechaRegistro);
                return fechaRegistroDate >= fechaInicioDate && fechaRegistroDate <= fechaFinDate;
            });
        }
        
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
// IMÁGENES POR DETALLE DE SERVICIO
// ============================================

const actualizarImagenDetalle = async (req, res) => {
    try {
        const { detalleId } = req.params;
        
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const detalle = await DetalleOrden.findByPk(detalleId);
        
        if (!detalle) {
            return res.status(404).json({ error: 'Detalle no encontrado' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó ninguna imagen' });
        }
        
        const imagen_url = await fileService.saveFile(req.file, 'detalles');
        
        if (detalle.imagen_referencia_url) {
            await fileService.deleteFile(detalle.imagen_referencia_url);
        }
        
        detalle.imagen_referencia_url = imagen_url;
        await detalle.save();
        
        res.json({
            mensaje: 'Imagen de referencia actualizada correctamente',
            imagen_url: detalle.imagen_referencia_url,
            detalle_id: detalle.id
        });
        
    } catch (error) {
        logger.error('Error actualizando imagen de detalle:', error);
        res.status(500).json({ error: 'Error al actualizar la imagen', details: error.message });
    }
};

const eliminarImagenDetalle = async (req, res) => {
    try {
        const { detalleId } = req.params;
        
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const detalle = await DetalleOrden.findByPk(detalleId);
        
        if (!detalle) {
            return res.status(404).json({ error: 'Detalle no encontrado' });
        }
        
        if (detalle.imagen_referencia_url) {
            await fileService.deleteFile(detalle.imagen_referencia_url);
            detalle.imagen_referencia_url = null;
            await detalle.save();
        }
        
        res.json({ 
            mensaje: 'Imagen eliminada correctamente',
            detalle_id: detalle.id
        });
        
    } catch (error) {
        logger.error('Error eliminando imagen de detalle:', error);
        res.status(500).json({ error: 'Error al eliminar la imagen' });
    }
};

// ============================================
// ACTUALIZAR DETALLE DE ORDEN (cliente)
// ============================================

const actualizarDetalleOrden = async (req, res) => {
    try {
        const { detalleId } = req.params;
        const { cliente_nombre, cliente_codigo, detalle_cliente } = req.body;
        
        if (!req.usuario || !req.usuario.id) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const detalle = await DetalleOrden.findByPk(detalleId);
        
        if (!detalle) {
            return res.status(404).json({ error: 'Detalle no encontrado' });
        }
        
        if (cliente_nombre !== undefined) {
            detalle.cliente_nombre = cliente_nombre;
        }
        if (cliente_codigo !== undefined) {
            detalle.cliente_codigo = cliente_codigo;
        }
        if (detalle_cliente !== undefined) {
            detalle.detalle_cliente = detalle_cliente;
        }
        
        await detalle.save();
        
        logger.info(`Detalle de orden actualizado - ID: ${detalleId}, Cliente: ${cliente_nombre}, Código: ${cliente_codigo}`);
        
        res.json({
            mensaje: 'Detalle actualizado correctamente',
            detalle: detalle
        });
        
    } catch (error) {
        logger.error('Error actualizando detalle de orden:', error);
        res.status(500).json({ error: 'Error al actualizar el detalle', details: error.message });
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
    obtenerOrdenesConFiltrosAvanzados,
    actualizarImagenDetalle,
    eliminarImagenDetalle,
    actualizarDetalleOrden
};