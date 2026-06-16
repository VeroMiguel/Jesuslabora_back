// doctorController.js - CORREGIDO SIN JSON_ARRAYAGG

const { Doctor, Orden, Servicio, sequelize } = require('../models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const fileService = require('../services/fileService');

const obtenerDoctores = async (req, res) => {
    try {
        const doctores = await Doctor.findAll({
            where: { activo: true },
            include: [{
                model: Orden,
                as: 'ordenes',
                required: false,
                limit: 5
            }],
            order: [['nombre', 'ASC']]
        });

        res.json(doctores);
    } catch (error) {
        logger.error('Error obteniendo doctores:', error);
        res.status(500).json({ error: 'Error al obtener doctores' });
    }
};

// doctorController.js - CORREGIR obtenerDoctorPorId (parte de detalles)

const obtenerDoctorPorId = async (req, res) => {
    try {
        const { id } = req.params;
        
        const doctor = await Doctor.findByPk(id, {
            attributes: ['id', 'nombre', 'telefono_whatsapp', 'logo_url', 'direccion', 'activo']
        });

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor no encontrado' });
        }

        // Obtener órdenes del doctor
        const ordenes = await sequelize.query(`
            SELECT 
                o.id,
                o.id_externo,
                o.fecha_registro,
                o.estado,
                o.total,
                o.cliente_nombre,
                COALESCE(SUM(p.monto), 0) as total_pagado,
                o.total - COALESCE(SUM(p.monto), 0) as saldo
            FROM ordenes o
            LEFT JOIN pagos p ON o.id = p.orden_id
            WHERE o.doctor_id = :doctorId
            GROUP BY o.id, o.id_externo, o.fecha_registro, o.estado, o.total, o.cliente_nombre
            ORDER BY o.fecha_registro DESC
        `, { 
            replacements: { doctorId: id },
            type: sequelize.QueryTypes.SELECT 
        });

        // Obtener detalles de cada orden - CORREGIDO para mostrar nombres de servicios
        const ordenesConDetalles = [];
        
        for (const orden of ordenes) {
            // Obtener detalles de la orden con nombres de servicios
            const detalles = await sequelize.query(`
                SELECT 
                    do.id,
                    s.nombre as servicio_nombre,
                    do.precio_unitario,
                    do.cantidad,
                    do.fecha_limite,
                    do.hora_limite,
                    do.cliente_nombre,
                    do.detalle_cliente
                FROM detalles_orden do
                JOIN servicios s ON do.servicio_id = s.id
                WHERE do.orden_id = :ordenId
                ORDER BY do.orden ASC
            `, {
                replacements: { ordenId: orden.id },
                type: sequelize.QueryTypes.SELECT
            });
            
            // ✅ Construir el nombre de servicio para mostrar (puede ser múltiples)
            let serviciosTexto = '';
            if (detalles.length > 0) {
                const nombresServicios = detalles.map(d => d.servicio_nombre);
                serviciosTexto = nombresServicios.join(', ');
            } else {
                serviciosTexto = 'Sin servicio';
            }
            
            ordenesConDetalles.push({
                ...orden,
                servicio_nombre: serviciosTexto,  // ← Agregar campo para mostrar
                detalles: detalles
            });
        }

        // Calcular resumen
        const resumen = {
            total_ordenes: ordenesConDetalles.length,
            ordenes_pendientes: ordenesConDetalles.filter(o => o.estado === 'pendiente').length,
            ordenes_terminadas: ordenesConDetalles.filter(o => o.estado === 'terminado').length,
            total_facturado: ordenesConDetalles.reduce((sum, o) => sum + o.total, 0),
            total_pagado: ordenesConDetalles.reduce((sum, o) => sum + (o.total_pagado || 0), 0),
            deuda_total: ordenesConDetalles.reduce((sum, o) => sum + o.saldo, 0)
        };

        res.json({
            ...doctor.toJSON(),
            resumen,
            ordenes: ordenesConDetalles
        });

    } catch (error) {
        logger.error('Error obteniendo doctor:', error);
        res.status(500).json({ error: 'Error al obtener doctor' });
    }
};

const crearDoctor = async (req, res) => {
    try {
        const { nombre, telefono_whatsapp, direccion, notas } = req.body;

        const existeNombre = await Doctor.findOne({ 
            where: { 
                nombre: { [Op.like]: nombre },
                activo: true 
            } 
        });

        if (existeNombre) {
            return res.status(400).json({ error: 'Ya existe un doctor con ese nombre' });
        }

        if (telefono_whatsapp && telefono_whatsapp.trim() !== '') {
            const existeTelefono = await Doctor.findOne({
                where: {
                    telefono_whatsapp: telefono_whatsapp,
                    activo: true
                }
            });

            if (existeTelefono) {
                return res.status(400).json({ error: 'Este número de WhatsApp ya está registrado por otro doctor' });
            }
        }

        let logo_url = null;
        if (req.file) {
            logo_url = await fileService.saveFile(req.file, 'doctores');
        }

        const doctor = await Doctor.create({
            nombre,
            telefono_whatsapp,
            direccion,
            logo_url
        });

        logger.info(`Doctor creado - ID: ${doctor.id}, Nombre: ${doctor.nombre}`);

        res.status(201).json({
            mensaje: 'Doctor creado correctamente',
            doctor
        });

    } catch (error) {
        logger.error('Error creando doctor:', error);
        res.status(500).json({ error: 'Error al crear doctor' });
    }
};

const actualizarDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const doctor = await Doctor.findByPk(id);

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor no encontrado' });
        }

        const { telefono_whatsapp } = req.body;

        if (telefono_whatsapp && telefono_whatsapp.trim() !== '' && telefono_whatsapp !== doctor.telefono_whatsapp) {
            const existeTelefono = await Doctor.findOne({
                where: {
                    telefono_whatsapp: telefono_whatsapp,
                    activo: true,
                    id: { [Op.ne]: id }
                }
            });

            if (existeTelefono) {
                return res.status(400).json({ error: 'Este número de WhatsApp ya está registrado por otro doctor' });
            }
        }

        const datosActualizados = { ...req.body };

        if (req.file) {
            if (doctor.logo_url) {
                await fileService.deleteFile(doctor.logo_url);
            }
            datosActualizados.logo_url = await fileService.saveFile(req.file, 'doctores');
        }

        await doctor.update(datosActualizados);

        logger.info(`Doctor actualizado - ID: ${id}`);

        res.json({
            mensaje: 'Doctor actualizado correctamente',
            doctor
        });

    } catch (error) {
        logger.error('Error actualizando doctor:', error);
        res.status(500).json({ error: 'Error al actualizar doctor' });
    }
};

const eliminarDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const doctor = await Doctor.findByPk(id);

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor no encontrado' });
        }

        const ordenesAsociadas = await Orden.count({ where: { doctor_id: id } });
        
        if (ordenesAsociadas > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar el doctor porque tiene ${ordenesAsociadas} órdenes asociadas. Primero elimine o reasigne esas órdenes.` 
            });
        }

        if (doctor.logo_url) {
            await fileService.deleteFile(doctor.logo_url);
        }

        await doctor.destroy();

        logger.info(`Doctor eliminado físicamente - ID: ${id}`);

        res.json({
            mensaje: 'Doctor eliminado correctamente'
        });

    } catch (error) {
        logger.error('Error eliminando doctor:', error);
        res.status(500).json({ error: 'Error al eliminar doctor' });
    }
};

const obtenerResumenDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        
        const resumen = await sequelize.query(`
            SELECT 
                COUNT(DISTINCT o.id) as total_ordenes,
                COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as ordenes_pendientes,
                COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as ordenes_terminadas,
                COALESCE(SUM(o.total), 0) as total_facturado,
                COALESCE((
                    SELECT SUM(p.monto) 
                    FROM pagos p 
                    WHERE p.orden_id IN (SELECT o2.id FROM ordenes o2 WHERE o2.doctor_id = :doctorId)
                ), 0) as total_pagado,
                COALESCE(SUM(o.total), 0) - COALESCE((
                    SELECT SUM(p.monto) 
                    FROM pagos p 
                    WHERE p.orden_id IN (SELECT o2.id FROM ordenes o2 WHERE o2.doctor_id = :doctorId)
                ), 0) as deuda_total
            FROM ordenes o
            WHERE o.doctor_id = :doctorId
        `, { 
            replacements: { doctorId: id },
            type: sequelize.QueryTypes.SELECT 
        });

        res.json(resumen[0] || {
            total_ordenes: 0,
            ordenes_pendientes: 0,
            ordenes_terminadas: 0,
            total_facturado: 0,
            total_pagado: 0,
            deuda_total: 0
        });

    } catch (error) {
        logger.error('Error obteniendo resumen del doctor:', error);
        res.status(500).json({ error: 'Error al obtener resumen' });
    }
};

module.exports = {
    obtenerDoctores,
    obtenerDoctorPorId,
    crearDoctor,
    actualizarDoctor,
    eliminarDoctor,
    obtenerResumenDoctor
};