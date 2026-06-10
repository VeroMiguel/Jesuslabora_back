const { sequelize, Doctor, Servicio, Orden, Pago } = require('../models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

// Reporte de Ingresos - CORREGIDO para usar creado_en
// Reporte de Ingresos - CORREGIDO
const getReporteIngresos = async (req, res) => {
    try {
        const { fechaInicio, fechaFin, grupo = 'mes' } = req.query;

        let groupFormat;
        let selectFormat;

        switch(grupo) {
            case 'dia':
                groupFormat = 'DATE(creado_en)';
                selectFormat = 'DATE(creado_en) as periodo';
                break;
            case 'semana':
                groupFormat = 'YEARWEEK(creado_en)';
                selectFormat = 'CONCAT(YEAR(creado_en), "-", WEEK(creado_en)) as periodo';
                break;
            case 'mes':
            default:
                groupFormat = 'DATE_FORMAT(creado_en, "%Y-%m")';
                selectFormat = 'DATE_FORMAT(creado_en, "%Y-%m") as periodo';
        }

        const ingresos = await sequelize.query(`
            SELECT 
                ${selectFormat},
                SUM(CASE WHEN metodo_pago = 'efectivo' THEN monto ELSE 0 END) as efectivo,
                SUM(CASE WHEN metodo_pago = 'tarjeta' THEN monto ELSE 0 END) as tarjeta,
                SUM(CASE WHEN metodo_pago IN ('transferencia', 'yape', 'plin') THEN monto ELSE 0 END) as digital,
                SUM(monto) as total
            FROM pagos
            WHERE creado_en BETWEEN :fechaInicio AND :fechaFin
            GROUP BY ${groupFormat}
            ORDER BY periodo ASC
        `, {
            replacements: { 
                fechaInicio: fechaInicio + ' 00:00:00', 
                fechaFin: fechaFin + ' 23:59:59' 
            },
            type: sequelize.QueryTypes.SELECT
        });

        // Procesar los resultados para asegurar tipos numéricos
        const ingresosProcesados = ingresos.map(i => ({
            ...i,
            efectivo: Number(i.efectivo) || 0,
            tarjeta: Number(i.tarjeta) || 0,
            digital: Number(i.digital) || 0,
            total: Number(i.total) || 0
        }));

        // Totales por método de pago
        const totales = await sequelize.query(`
            SELECT 
                SUM(CASE WHEN metodo_pago = 'efectivo' THEN monto ELSE 0 END) as efectivo,
                SUM(CASE WHEN metodo_pago = 'tarjeta' THEN monto ELSE 0 END) as tarjeta,
                SUM(CASE WHEN metodo_pago IN ('transferencia', 'yape', 'plin') THEN monto ELSE 0 END) as digital,
                SUM(monto) as total
            FROM pagos
            WHERE creado_en BETWEEN :fechaInicio AND :fechaFin
        `, {
            replacements: { 
                fechaInicio: fechaInicio + ' 00:00:00', 
                fechaFin: fechaFin + ' 23:59:59' 
            },
            type: sequelize.QueryTypes.SELECT
        });

        const totalesProcesados = totales[0] || { efectivo: 0, tarjeta: 0, digital: 0, total: 0 };

        res.json({
            detalle: ingresosProcesados,
            total: Number(totalesProcesados.total) || 0,
            porMetodo: {
                efectivo: Number(totalesProcesados.efectivo) || 0,
                tarjeta: Number(totalesProcesados.tarjeta) || 0,
                transferencia: Number(totalesProcesados.digital) || 0,
                yape: 0,
                plin: 0
            }
        });

    } catch (error) {
        logger.error('Error en reporte de ingresos:', error);
        res.status(500).json({ error: 'Error al generar reporte de ingresos' });
    }
};


// Reporte de Doctores (Rendimiento) - CORREGIDO
// Reporte de Doctores (Rendimiento) - CORREGIDO (versión sin toFixed)
const getReporteDoctores = async (req, res) => {
    try {
        const doctores = await sequelize.query(`
            SELECT 
                d.id as doctorId,
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                d.logo_url,
                COUNT(DISTINCT o.id) as total_ordenes,
                COUNT(DISTINCT CASE WHEN o.estado IN ('pendiente', 'en_proceso') THEN o.id END) as ordenes_pendientes,
                COUNT(DISTINCT CASE WHEN o.fecha_limite < CURDATE() AND o.estado IN ('pendiente', 'en_proceso') THEN o.id END) as ordenes_vencidas,
                COALESCE(SUM(o.total), 0) as total_facturado,
                COALESCE(SUM(p.total_pagado), 0) as total_pagado,
                COALESCE(SUM(o.total) - COALESCE(SUM(p.total_pagado), 0), 0) as deuda_total,
                AVG(o.total) as promedio_por_orden,
                MAX(o.fecha_limite) as proxima_entrega
            FROM doctores d
            LEFT JOIN ordenes o ON d.id = o.doctor_id  -- <-- Eliminar "AND o.activo = TRUE"
            LEFT JOIN (
                SELECT orden_id, SUM(monto) as total_pagado
                FROM pagos
                GROUP BY orden_id
            ) p ON o.id = p.orden_id
            WHERE d.activo = TRUE
            GROUP BY d.id, d.nombre, d.telefono_whatsapp, d.logo_url
            ORDER BY deuda_total DESC
        `, { type: sequelize.QueryTypes.SELECT });

        // Procesar los datos sin usar toFixed() directamente
        const doctoresProcesados = doctores.map(d => ({
            ...d,
            total_facturado: parseFloat(d.total_facturado) || 0,
            total_pagado: parseFloat(d.total_pagado) || 0,
            deuda_total: parseFloat(d.deuda_total) || 0,
            promedio_por_orden: d.promedio_por_orden ? parseFloat(d.promedio_por_orden) : 0
        }));

        // Calcular deuda total
        const deudaTotal = doctoresProcesados.reduce((sum, d) => sum + d.deuda_total, 0);

        res.json({
            doctores: doctoresProcesados,
            totalDoctores: doctoresProcesados.length,
            deudaTotal: deudaTotal
        });

    } catch (error) {
        logger.error('Error en reporte de doctores:', error);
        res.status(500).json({ error: 'Error al generar reporte de doctores' });
    }
};

// Reporte de Servicios
const getReporteServicios = async (req, res) => {
    try {
        const servicios = await sequelize.query(`
            SELECT 
                s.id,
                s.nombre,
                COUNT(DISTINCT o.id) as cantidad,
                COALESCE(SUM(o.total), 0) as total_facturado,
                COALESCE(AVG(o.total), 0) as precio_promedio
            FROM servicios s
            LEFT JOIN ordenes o ON s.id = o.servicio_id  -- <-- Eliminar "AND o.activo = TRUE"
            WHERE s.activo = TRUE
            GROUP BY s.id, s.nombre
            ORDER BY cantidad DESC
        `, { type: sequelize.QueryTypes.SELECT });

        res.json(servicios);
    } catch (error) {
        logger.error('Error en reporte de servicios:', error);
        res.status(500).json({ error: 'Error al generar reporte de servicios' });
    }
};

// Reporte de Morosidad
// Reporte de Morosidad - CORREGIDO para asegurar tipos numéricos
const getReporteMorosidad = async (req, res) => {
    try {
        const deudas = await sequelize.query(`
            SELECT 
                d.id as doctorId,
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                COUNT(DISTINCT o.id) as ordenes,
                COUNT(DISTINCT CASE WHEN o.fecha_limite < CURDATE() AND o.estado IN ('pendiente', 'en_proceso') THEN o.id END) as vencidas,
                COALESCE(SUM(o.total - COALESCE(p.total_pagado, 0)), 0) as deuda,
                DATEDIFF(CURDATE(), MIN(o.fecha_limite)) as diasMora
            FROM doctores d
            JOIN ordenes o ON d.id = o.doctor_id  -- <-- Eliminar "AND o.activo = TRUE"
            LEFT JOIN (
                SELECT orden_id, SUM(monto) as total_pagado
                FROM pagos
                GROUP BY orden_id
            ) p ON o.id = p.orden_id
            WHERE o.total > COALESCE(p.total_pagado, 0)
            GROUP BY d.id, d.nombre, d.telefono_whatsapp
            HAVING deuda > 0
            ORDER BY deuda DESC
        `, { type: sequelize.QueryTypes.SELECT });

        // Asegurar que los valores numéricos sean números
        const deudasProcesadas = deudas.map(d => ({
            ...d,
            ordenes: Number(d.ordenes) || 0,
            vencidas: Number(d.vencidas) || 0,
            deuda: Number(d.deuda) || 0,
            diasMora: Number(d.diasMora) || 0
        }));

        const resumen = {
            deudaTotal: deudasProcesadas.reduce((sum, d) => sum + d.deuda, 0),
            clientesMorosos: deudasProcesadas.length,
            ordenesVencidas: deudasProcesadas.reduce((sum, d) => sum + d.vencidas, 0)
        };

        res.json({
            detalle: deudasProcesadas,
            resumen
        });

    } catch (error) {
        logger.error('Error en reporte de morosidad:', error);
        res.status(500).json({ error: 'Error al generar reporte de morosidad' });
    }
};

// Reporte de Productividad - VERSIÓN MEJORADA
// Reporte de Productividad - VERSIÓN CORREGIDA
const getReporteProductividad = async (req, res) => {
    try {
        const rendimiento = await sequelize.query(`
            SELECT 
                d.nombre as doctor,
                COUNT(CASE WHEN o.estado = 'terminado' THEN 1 END) as completadas,
                COUNT(CASE WHEN o.estado = 'pendiente' THEN 1 END) as pendientes,
                ROUND(
                    (COUNT(CASE WHEN o.estado = 'terminado' THEN 1 END) * 100.0) / 
                    NULLIF(COUNT(*), 0), 2
                ) as eficiencia
            FROM doctores d
            LEFT JOIN ordenes o ON d.id = o.doctor_id  -- <-- Eliminar "AND o.activo = TRUE"
            WHERE d.activo = TRUE
            GROUP BY d.nombre
            ORDER BY eficiencia DESC, completadas DESC
        `, { type: sequelize.QueryTypes.SELECT });

        // Calcular totales generales - CORREGIDO
        let totalCompletadas = 0;
        let totalPendientes = 0;
        let totalOrdenes = 0;
        
        
        const rendimientoProcesado = rendimiento.map(r => {
            const completadas = Number(r.completadas) || 0;
            const pendientes = Number(r.pendientes) || 0;
            const eficiencia = Number(r.eficiencia) || 0;
            
            totalCompletadas += completadas;
            totalPendientes += pendientes;
            totalOrdenes = totalCompletadas + totalPendientes;
            
            return {
                doctor: r.doctor,
                completadas: completadas,
                pendientes: pendientes,
                eficiencia: eficiencia
            };
        });
        
        const resumen = {
            eficiencia: totalOrdenes > 0 ? Math.round((totalCompletadas * 100) / totalOrdenes) : 0,
            completadasMes: await getCompletadasMes(),
            totalCompletadas: totalCompletadas,
            totalPendientes: totalPendientes
        };

        res.json({
            rendimiento: rendimientoProcesado,
            resumen
        });

    } catch (error) {
        logger.error('Error en reporte de productividad:', error);
        res.status(500).json({ error: 'Error al generar reporte de productividad' });
    }
};

// Función auxiliar para obtener completadas del mes
async function getCompletadasMes() {
    const [result] = await sequelize.query(`
        SELECT COUNT(*) as total
        FROM ordenes
        WHERE estado = 'terminado'
        AND MONTH(fecha_registro) = MONTH(CURDATE())
        AND YEAR(fecha_registro) = YEAR(CURDATE())
    `, { type: sequelize.QueryTypes.SELECT });
    
    return result?.total || 0;
}


// Exportar a Excel (generar CSV)
// Exportar a Excel (con múltiples hojas para "todos")
const exportarReporte = async (req, res) => {
    try {
        const { tipo } = req.params;
        const workbook = new ExcelJS.Workbook();
        
        // Configurar estilos
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } }
        };

        if (tipo === 'todos') {
            // Obtener todos los datos
            const todos = await getTodosReportesData();
            let filename = `reportes_completos_${new Date().toISOString().split('T')[0]}.xlsx`;
            
            // 1. Hoja de Ingresos
            if (todos.ingresos && todos.ingresos.length > 0) {
                const wsIngresos = workbook.addWorksheet('Ingresos');
                const headersIngresos = Object.keys(todos.ingresos[0]);
                wsIngresos.addRow(headersIngresos);
                wsIngresos.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.ingresos.forEach(item => {
                    wsIngresos.addRow(Object.values(item));
                });
                wsIngresos.columns.forEach(col => {
                    col.width = 15;
                });
            }
            
            // 2. Hoja de Doctores
            if (todos.doctores && todos.doctores.length > 0) {
                const wsDoctores = workbook.addWorksheet('Doctores');
                const headersDoctores = Object.keys(todos.doctores[0]);
                wsDoctores.addRow(headersDoctores);
                wsDoctores.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.doctores.forEach(item => {
                    wsDoctores.addRow(Object.values(item));
                });
                wsDoctores.columns.forEach(col => {
                    col.width = 20;
                });
            }
            
            // 3. Hoja de Servicios
            if (todos.servicios && todos.servicios.length > 0) {
                const wsServicios = workbook.addWorksheet('Servicios');
                const headersServicios = Object.keys(todos.servicios[0]);
                wsServicios.addRow(headersServicios);
                wsServicios.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.servicios.forEach(item => {
                    wsServicios.addRow(Object.values(item));
                });
                wsServicios.columns.forEach(col => {
                    col.width = 25;
                });
            }
            
            // 4. Hoja de Morosidad
            if (todos.morosidad && todos.morosidad.length > 0) {
                const wsMorosidad = workbook.addWorksheet('Morosidad');
                const headersMorosidad = Object.keys(todos.morosidad[0]);
                wsMorosidad.addRow(headersMorosidad);
                wsMorosidad.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.morosidad.forEach(item => {
                    wsMorosidad.addRow(Object.values(item));
                });
                wsMorosidad.columns.forEach(col => {
                    col.width = 18;
                });
            }
            
            // 5. Hoja de Productividad
            if (todos.productividad && todos.productividad.length > 0) {
                const wsProductividad = workbook.addWorksheet('Productividad');
                const headersProductividad = Object.keys(todos.productividad[0]);
                wsProductividad.addRow(headersProductividad);
                wsProductividad.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.productividad.forEach(item => {
                    wsProductividad.addRow(Object.values(item));
                });
                wsProductividad.columns.forEach(col => {
                    col.width = 20;
                });
            }
            
            // Generar buffer
            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
            
        } else {
            // Para reportes individuales (ingresos, doctores, etc.)
            let data = [];
            let filename = `reporte_${tipo}_${new Date().toISOString().split('T')[0]}.xlsx`;

            switch(tipo) {
                case 'ingresos':
                    data = await getReporteIngresosData(req.query);
                    break;
                case 'doctores':
                    data = await getReporteDoctoresData();
                    break;
                case 'servicios':
                    data = await getReporteServiciosData();
                    break;
                case 'morosidad':
                    data = await getReporteMorosidadData();
                    break;
                case 'productividad':
                    data = await getReporteProductividadData();
                    break;
                default:
                    return res.status(400).json({ error: 'Tipo de reporte no válido' });
            }

            const worksheet = workbook.addWorksheet('Reporte');

            if (data && data.length > 0) {
                const headers = Object.keys(data[0]);
                worksheet.addRow(headers);
                worksheet.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                data.forEach(item => {
                    worksheet.addRow(Object.values(item));
                });
                worksheet.columns.forEach(column => {
                    let maxLength = 0;
                    column.eachCell({ includeEmpty: true }, (cell) => {
                        const cellValue = cell.value ? cell.value.toString() : '';
                        maxLength = Math.max(maxLength, cellValue.length);
                    });
                    column.width = Math.min(maxLength + 2, 50);
                });
            }

            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
        }

    } catch (error) {
        logger.error('Error exportando reporte:', error);
        res.status(500).json({ error: 'Error al exportar reporte' });
    }
};

// Funciones auxiliares para exportación (versiones que devuelven datos planos)
async function getReporteIngresosData(params) {
    const { fechaInicio, fechaFin, grupo = 'mes' } = params;
    
    let groupFormat;
    let selectFormat;

    switch(grupo) {
        case 'dia':
            groupFormat = 'DATE(creado_en)';
            selectFormat = 'DATE(creado_en) as periodo';
            break;
        case 'semana':
            groupFormat = 'YEARWEEK(creado_en)';
            selectFormat = 'CONCAT(YEAR(creado_en), "-", WEEK(creado_en)) as periodo';
            break;
        case 'mes':
        default:
            groupFormat = 'DATE_FORMAT(creado_en, "%Y-%m")';
            selectFormat = 'DATE_FORMAT(creado_en, "%Y-%m") as periodo';
    }

    const ingresos = await sequelize.query(`
        SELECT 
            ${selectFormat},
            SUM(CASE WHEN metodo_pago = 'efectivo' THEN monto ELSE 0 END) as efectivo,
            SUM(CASE WHEN metodo_pago = 'tarjeta' THEN monto ELSE 0 END) as tarjeta,
            SUM(CASE WHEN metodo_pago IN ('transferencia', 'yape', 'plin') THEN monto ELSE 0 END) as digital,
            SUM(monto) as total
        FROM pagos
        WHERE creado_en BETWEEN :fechaInicio AND :fechaFin
        GROUP BY ${groupFormat}
        ORDER BY periodo ASC
    `, {
        replacements: { 
            fechaInicio: fechaInicio + ' 00:00:00', 
            fechaFin: fechaFin + ' 23:59:59' 
        },
        type: sequelize.QueryTypes.SELECT
    });

    return ingresos.map(i => ({
        periodo: i.periodo,
        efectivo: Number(i.efectivo) || 0,
        tarjeta: Number(i.tarjeta) || 0,
        digital: Number(i.digital) || 0,
        total: Number(i.total) || 0
    }));
}

async function getReporteDoctoresData() {
    const doctores = await sequelize.query(`
        SELECT 
            d.nombre as doctor,
            d.telefono_whatsapp as telefono,
            COUNT(DISTINCT o.id) as total_ordenes,
            COUNT(DISTINCT CASE WHEN o.estado IN ('pendiente', 'en_proceso') THEN o.id END) as ordenes_pendientes,
            COUNT(DISTINCT CASE WHEN o.fecha_limite < CURDATE() AND o.estado IN ('pendiente', 'en_proceso') THEN o.id END) as ordenes_vencidas,
            COALESCE(SUM(o.total), 0) as total_facturado,
            COALESCE(SUM(p.total_pagado), 0) as total_pagado,
            COALESCE(SUM(o.total) - COALESCE(SUM(p.total_pagado), 0), 0) as deuda_total
        FROM doctores d
        LEFT JOIN ordenes o ON d.id = o.doctor_id  -- ✅ Eliminado "AND o.activo = TRUE"
        LEFT JOIN (
            SELECT orden_id, SUM(monto) as total_pagado
            FROM pagos
            GROUP BY orden_id
        ) p ON o.id = p.orden_id
        WHERE d.activo = TRUE
        GROUP BY d.nombre, d.telefono_whatsapp
        ORDER BY deuda_total DESC
    `, { type: sequelize.QueryTypes.SELECT });

    return doctores.map(d => ({
        doctor: d.doctor,
        telefono: d.telefono || '',
        total_ordenes: Number(d.total_ordenes) || 0,
        ordenes_pendientes: Number(d.ordenes_pendientes) || 0,
        ordenes_vencidas: Number(d.ordenes_vencidas) || 0,
        total_facturado: Number(d.total_facturado) || 0,
        total_pagado: Number(d.total_pagado) || 0,
        deuda_total: Number(d.deuda_total) || 0
    }));
}

async function getReporteServiciosData() {
    const servicios = await sequelize.query(`
        SELECT 
            s.nombre,
            COUNT(DISTINCT o.id) as cantidad,
            COALESCE(SUM(o.total), 0) as total_facturado,
            COALESCE(AVG(o.total), 0) as precio_promedio
        FROM servicios s
        LEFT JOIN ordenes o ON s.id = o.servicio_id  -- ✅ Eliminado "AND o.activo = TRUE"
        WHERE s.activo = TRUE
        GROUP BY s.nombre
        ORDER BY cantidad DESC
    `, { type: sequelize.QueryTypes.SELECT });

    return servicios.map(s => ({
        servicio: s.nombre,
        cantidad: Number(s.cantidad) || 0,
        total_facturado: Number(s.total_facturado) || 0,
        precio_promedio: Number(s.precio_promedio) || 0
    }));
}

async function getReporteMorosidadData() {
    const deudas = await sequelize.query(`
        SELECT 
            d.nombre as doctor,
            d.telefono_whatsapp as telefono,
            COUNT(DISTINCT o.id) as ordenes,
            COUNT(DISTINCT CASE WHEN o.fecha_limite < CURDATE() AND o.estado IN ('pendiente', 'en_proceso') THEN o.id END) as vencidas,
            COALESCE(SUM(o.total - COALESCE(p.total_pagado, 0)), 0) as deuda,
            DATEDIFF(CURDATE(), MIN(o.fecha_limite)) as diasMora
        FROM doctores d
        JOIN ordenes o ON d.id = o.doctor_id  -- ✅ Eliminado "AND o.activo = TRUE"
        LEFT JOIN (
            SELECT orden_id, SUM(monto) as total_pagado
            FROM pagos
            GROUP BY orden_id
        ) p ON o.id = p.orden_id
        WHERE o.total > COALESCE(p.total_pagado, 0)
        GROUP BY d.nombre, d.telefono_whatsapp
        HAVING deuda > 0
        ORDER BY deuda DESC
    `, { type: sequelize.QueryTypes.SELECT });

    return deudas.map(d => ({
        doctor: d.doctor,
        telefono: d.telefono || '',
        ordenes: Number(d.ordenes) || 0,
        vencidas: Number(d.vencidas) || 0,
        deuda: Number(d.deuda) || 0,
        dias_mora: Number(d.diasMora) || 0
    }));
}

async function getReporteProductividadData() {
    const rendimiento = await sequelize.query(`
        SELECT 
            d.nombre as doctor,
            COUNT(CASE WHEN o.estado = 'terminado' THEN 1 END) as completadas,
            COUNT(CASE WHEN o.estado IN ('pendiente', 'en_proceso') THEN 1 END) as pendientes,
            ROUND(
                (COUNT(CASE WHEN o.estado = 'terminado' THEN 1 END) * 100.0) / 
                NULLIF(COUNT(*), 0), 2
            ) as eficiencia
        FROM doctores d
        LEFT JOIN ordenes o ON d.id = o.doctor_id  -- ✅ Eliminado "AND o.activo = TRUE"
        WHERE d.activo = TRUE
        GROUP BY d.nombre
        ORDER BY eficiencia DESC
    `, { type: sequelize.QueryTypes.SELECT });

    return rendimiento.map(r => ({
        doctor: r.doctor,
        completadas: Number(r.completadas) || 0,
        pendientes: Number(r.pendientes) || 0,
        eficiencia: Number(r.eficiencia) || 0
    }));
}
async function getTodosReportesData() {
    // Obtener fecha de hace 6 meses para ingresos
    const fechaFin = new Date().toISOString().split('T')[0];
    const fechaInicio = new Date();
    fechaInicio.setMonth(fechaInicio.getMonth() - 6);
    
    const ingresos = await getReporteIngresosData({ 
        fechaInicio: fechaInicio.toISOString().split('T')[0],
        fechaFin: fechaFin,
        grupo: 'mes'
    });
    
    const doctores = await getReporteDoctoresData();
    const servicios = await getReporteServiciosData();
    const morosidad = await getReporteMorosidadData();
    const productividad = await getReporteProductividadData();

    return {
        ingresos,
        doctores,
        servicios,
        morosidad,
        productividad
    };
}


// Función auxiliar para convertir a CSV
function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    // Agregar headers
    csvRows.push(headers.join(','));
    
    // Agregar filas
    for (const row of data) {
        const values = headers.map(header => {
            const val = row[header] || '';
            return `"${val.toString().replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
}

// Reporte de tendencia mensual
const getTendenciaMensual = async (req, res) => {
    try {
        const tendencia = await sequelize.query(`
            SELECT 
                DATE_FORMAT(fecha_registro, '%Y-%m') as mes,
                MONTH(fecha_registro) as mes_numero,
                YEAR(fecha_registro) as año,
                COUNT(*) as total_ordenes,
                SUM(CASE WHEN estado = 'terminado' THEN 1 ELSE 0 END) as completadas
            FROM ordenes
            WHERE fecha_registro >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY YEAR(fecha_registro), MONTH(fecha_registro), DATE_FORMAT(fecha_registro, '%Y-%m')
            ORDER BY año ASC, mes_numero ASC
        `, { type: sequelize.QueryTypes.SELECT });

        const nombresMeses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        
        const resultado = [];
        const hoy = new Date();
        
        for (let i = 5; i >= 0; i--) {
            const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
            const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
            const mesNombre = nombresMeses[fecha.getMonth()];
            
            const dato = tendencia.find(t => t.mes === mesKey);
            
            resultado.push({
                mes: mesNombre,
                mes_completo: mesKey,
                total_ordenes: dato ? parseInt(dato.total_ordenes) : 0,
                completadas: dato ? parseInt(dato.completadas) : 0
            });
        }

        res.json(resultado);
    } catch (error) {
        logger.error('Error obteniendo tendencia mensual:', error);
        res.status(500).json({ error: 'Error al obtener tendencia mensual' });
    }
};



module.exports = {
    getReporteIngresos,
    getReporteDoctores,
    getReporteServicios,
    getReporteMorosidad,
    getReporteProductividad,
    getTendenciaMensual, 
    exportarReporte
};