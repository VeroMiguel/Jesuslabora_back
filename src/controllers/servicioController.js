const { Servicio, Orden } = require('../models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const fileService = require('../services/fileService'); // <-- IMPORTAR

const obtenerServicios = async (req, res) => {
    try {
        const servicios = await Servicio.findAll({
            where: { activo: true },  // ← SERVICIOS tiene activo
            include: [{
                model: Orden,
                as: 'ordenes',
                required: false,
                // Eliminar el where: { activo: true }
                limit: 5
            }],
            order: [['nombre', 'ASC']]
        });

        res.json(servicios);
    } catch (error) {
        logger.error('Error obteniendo servicios:', error);
        res.status(500).json({ error: 'Error al obtener servicios' });
    }
};
const obtenerServicioPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const servicio = await Servicio.findByPk(id);

        if (!servicio) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        res.json(servicio);
    } catch (error) {
        logger.error('Error obteniendo servicio:', error);
        res.status(500).json({ error: 'Error al obtener servicio' });
    }
};

const crearServicio = async (req, res) => {
    try {
        const { nombre, precio_referencial } = req.body;

        // Verificar si ya existe
        const existe = await Servicio.findOne({ 
            where: { 
                nombre: { [Op.like]: nombre },
                activo: true 
            } 
        });

        if (existe) {
            return res.status(400).json({ error: 'Ya existe un servicio con ese nombre' });
        }

        // Procesar precio_referencial
        let precioFinal = null;
        if (precio_referencial !== undefined && precio_referencial !== null && precio_referencial !== '') {
            const num = parseFloat(precio_referencial);
            if (!isNaN(num) && num >= 0) {
                precioFinal = num;
            } else {
                return res.status(400).json({ 
                    errores: [{
                        campo: 'precio_referencial',
                        mensaje: 'El precio debe ser un número positivo'
                    }]
                });
            }
        }

        // Procesar imagen si se subió
        let imagen_url = null;
        if (req.file) {
            imagen_url = await fileService.saveFile(req.file, 'servicios');
        }

        const servicio = await Servicio.create({
            nombre,
            precio_referencial: precioFinal,
            imagen_url  // <-- NUEVO
        });

        logger.info(`Servicio creado - ID: ${servicio.id}, Nombre: ${servicio.nombre}`);

        res.status(201).json({
            mensaje: 'Servicio creado correctamente',
            servicio
        });

    } catch (error) {
        logger.error('Error creando servicio:', error);
        res.status(500).json({ error: 'Error al crear servicio' });
    }
};

const actualizarServicio = async (req, res) => {
    try {
        const { id } = req.params;
        const servicio = await Servicio.findByPk(id);

        if (!servicio) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        const datosActualizados = { ...req.body };

        // Procesar imagen si se subió una nueva
        if (req.file) {
            // Eliminar imagen anterior si existe
            if (servicio.imagen_url) {
                await fileService.deleteFile(servicio.imagen_url);
            }
            datosActualizados.imagen_url = await fileService.saveFile(req.file, 'servicios');
        }

        await servicio.update(datosActualizados);

        logger.info(`Servicio actualizado - ID: ${id}`);

        res.json({
            mensaje: 'Servicio actualizado correctamente',
            servicio
        });

    } catch (error) {
        logger.error('Error actualizando servicio:', error);
        res.status(500).json({ error: 'Error al actualizar servicio' });
    }
};

const eliminarServicio = async (req, res) => {
    try {
        const { id } = req.params;
        const servicio = await Servicio.findByPk(id);

        if (!servicio) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        // Verificar si tiene órdenes asociadas
        const ordenesAsociadas = await Orden.count({ where: { servicio_id: id } });
        
        if (ordenesAsociadas > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar el servicio porque tiene ${ordenesAsociadas} órdenes asociadas. Primero elimine o reasigne esas órdenes.` 
            });
        }

        // Eliminar imagen si existe
        if (servicio.imagen_url) {
            await fileService.deleteFile(servicio.imagen_url);
        }

        // Eliminar físicamente de la base de datos
        await servicio.destroy();

        logger.info(`Servicio eliminado físicamente - ID: ${id}`);

        res.json({
            mensaje: 'Servicio eliminado correctamente'
        });

    } catch (error) {
        logger.error('Error eliminando servicio:', error);
        res.status(500).json({ error: 'Error al eliminar servicio' });
    }
};

const obtenerServiciosPorCategoria = async (req, res) => {
    try {
        const servicios = await Servicio.findAll({
            where: { activo: true },
            attributes: ['categoria', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
            group: ['categoria']
        });

        res.json(servicios);
    } catch (error) {
        logger.error('Error obteniendo categorías:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
};

module.exports = {
    obtenerServicios,
    obtenerServicioPorId,
    crearServicio,
    actualizarServicio,
    eliminarServicio,
    obtenerServiciosPorCategoria
};