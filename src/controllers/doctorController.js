const { Doctor, Orden,Servicio, sequelize } = require('../models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const fileService = require('../services/fileService');
const obtenerDoctores = async (req, res) => {
    try {
        const doctores = await Doctor.findAll({
            where: { activo: true },  // ← Esto está bien, DOCTORES tiene activo
            include: [{
                model: Orden,
                as: 'ordenes',
                required: false,
                // Eliminar el where: { activo: true } porque ORDENES ya no tiene activo
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

const obtenerDoctorPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const doctor = await Doctor.findByPk(id, {
            include: [{
                model: Orden,
                as: 'ordenes',
                // Eliminar el where: { activo: true }
                required: false,
                include: [{
                    model: Servicio,
                    as: 'servicio',
                    attributes: ['id', 'nombre']
                }]
            }]
        });

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor no encontrado' });
        }

        res.json(doctor);
    } catch (error) {
        logger.error('Error obteniendo doctor:', error);
        res.status(500).json({ error: 'Error al obtener doctor' });
    }
};

const crearDoctor = async (req, res) => {
    try {
        const { nombre, telefono_whatsapp, direccion, notas } = req.body;

        // Verificar si ya existe un doctor con el mismo nombre
        const existeNombre = await Doctor.findOne({ 
            where: { 
                nombre: { [Op.like]: nombre },
                activo: true 
            } 
        });

        if (existeNombre) {
            return res.status(400).json({ error: 'Ya existe un doctor con ese nombre' });
        }

        // Verificar si el teléfono ya está registrado (si se proporcionó)
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

        // Validar teléfono único (excepto el propio doctor)
        if (telefono_whatsapp && telefono_whatsapp.trim() !== '' && telefono_whatsapp !== doctor.telefono_whatsapp) {
            const existeTelefono = await Doctor.findOne({
                where: {
                    telefono_whatsapp: telefono_whatsapp,
                    activo: true,
                    id: { [Op.ne]: id } // diferente del doctor actual
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

        // Verificar si tiene órdenes asociadas
        const ordenesAsociadas = await Orden.count({ where: { doctor_id: id } });
        
        if (ordenesAsociadas > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar el doctor porque tiene ${ordenesAsociadas} órdenes asociadas. Primero elimine o reasigne esas órdenes.` 
            });
        }

        // Eliminar imagen si existe
        if (doctor.logo_url) {
            await fileService.deleteFile(doctor.logo_url);
        }

        // Eliminar físicamente de la base de datos
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
        
        const [resumen] = await sequelize.query(
            'SELECT * FROM vista_resumen_doctores WHERE id = ?',
            { replacements: [id], type: sequelize.QueryTypes.SELECT }
        );

        res.json(resumen || {});
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