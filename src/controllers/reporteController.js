// reporteController.js - VERSIÓN ACTUALIZADA PARA detalles_orden
const { sequelize, Doctor, Servicio, Orden, Pago, DetalleOrden } = require('../models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

// ============================================
// REPORTE DE INGRESOS (basado en pagos - no cambia)
// ============================================
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

        const ingresosProcesados = ingresos.map(i => ({
            ...i,
            efectivo: Number(i.efectivo) || 0,
            tarjeta: Number(i.tarjeta) || 0,
            digital: Number(i.digital) || 0,
            total: Number(i.total) || 0
        }));

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

// ============================================
// REPORTE DE DOCTORES (usando detalles_orden)
// ============================================
// reporteController.js - MODIFICAR getReporteDoctores

const getReporteDoctores = async (req, res) => {
    try {
        // ✅ Obtener fecha/hora actual del servidor
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
        console.log('🔍 [DEBUG] Fecha actual:', fechaActual, 'Hora:', horaActual);
        
        // ✅ Obtener datos por doctor con órdenes y detalles
        const doctores = await sequelize.query(`
            SELECT 
                d.id as doctorId,
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                d.logo_url,
                d.direccion,
                COUNT(DISTINCT o.id) as total_ordenes,
                COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as ordenes_pendientes,
                COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as ordenes_terminadas,
                COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total_facturado,
                COALESCE((
                    SELECT SUM(p.monto) 
                    FROM pagos p 
                    WHERE p.orden_id = o.id
                ), 0) as total_pagado
            FROM doctores d
            LEFT JOIN ordenes o ON d.id = o.doctor_id
            LEFT JOIN detalles_orden do ON o.id = do.orden_id
            WHERE d.activo = TRUE
            GROUP BY d.id, d.nombre, d.telefono_whatsapp, d.logo_url, d.direccion
        `, { type: sequelize.QueryTypes.SELECT });
        
        // ✅ Procesar cada doctor para calcular vencidas y próxima entrega
        const doctoresProcesados = await Promise.all(doctores.map(async (d) => {
            // ✅ Contar órdenes vencidas del doctor
            const vencidasResult = await sequelize.query(`
                SELECT COUNT(DISTINCT o.id) as vencidas
                FROM ordenes o
                JOIN detalles_orden do ON o.id = do.orden_id
                WHERE o.doctor_id = :doctorId
                AND o.estado = 'pendiente'
                AND (
                    do.fecha_limite < :fechaActual
                    OR (do.fecha_limite = :fechaActual AND do.hora_limite <= :horaActual)
                )
            `, { 
                replacements: { doctorId: d.doctorId, fechaActual, horaActual },
                type: sequelize.QueryTypes.SELECT 
            });
            
            // ✅ Calcular PRÓXIMA ENTREGA (fecha más cercana que NO ha vencido)
            // Si todas están vencidas, mostrar la que venció más tarde
            let proximaEntrega = null;
            
            const fechasDetalles = await sequelize.query(`
                SELECT 
                    do.fecha_limite,
                    do.hora_limite,
                    do.precio_unitario,
                    do.cantidad,
                    o.estado
                FROM detalles_orden do
                JOIN ordenes o ON do.orden_id = o.id
                WHERE o.doctor_id = :doctorId
                AND o.estado = 'pendiente'
                AND do.fecha_limite IS NOT NULL
                ORDER BY do.fecha_limite ASC, do.hora_limite ASC
            `, { 
                replacements: { doctorId: d.doctorId },
                type: sequelize.QueryTypes.SELECT 
            });
            
            // ✅ Buscar la primera fecha NO vencida
            let fechaMasCercanaFutura = null;
            let fechaMasRecienteVencida = null;
            
            for (const det of fechasDetalles) {
                const [year, month, day] = det.fecha_limite.split('-').map(Number);
                let horas = 23, minutos = 59;
                
                if (det.hora_limite) {
                    const parts = det.hora_limite.split(':');
                    horas = parseInt(parts[0]);
                    minutos = parseInt(parts[1]);
                }
                
                const fechaDetalle = new Date(year, month - 1, day, horas, minutos);
                const ahoraDate = new Date(fechaActual + 'T' + horaActual);
                
                if (fechaDetalle.getTime() >= ahoraDate.getTime()) {
                    // ✅ Esta fecha NO ha vencido (es futura o es hoy pero aún no pasa la hora)
                    fechaMasCercanaFutura = det.fecha_limite;
                    break;
                } else {
                    // ✅ Esta fecha ya venció, guardar la más reciente
                    fechaMasRecienteVencida = det.fecha_limite;
                }
            }
            
            // ✅ Si hay fecha futura, usarla; si no, usar la más reciente vencida
            proximaEntrega = fechaMasCercanaFutura || fechaMasRecienteVencida || null;
            
            const facturado = parseFloat(d.total_facturado) || 0;
            const pagado = parseFloat(d.total_pagado) || 0;
            const deuda = facturado - pagado;
            
            return {
                ...d,
                total_facturado: facturado,
                total_pagado: pagado,
                deuda_total: deuda,
                ordenes_vencidas: vencidasResult[0]?.vencidas || 0,
                proxima_entrega: proximaEntrega
            };
        }));
        
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
// ============================================
// REPORTE DE SERVICIOS (basado en detalles_orden)
// ============================================
const getReporteServicios = async (req, res) => {
    try {
        const servicios = await sequelize.query(`
            SELECT 
                s.id,
                s.nombre,
                COUNT(do.id) as cantidad,
                COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total_facturado,
                COALESCE(AVG(do.precio_unitario), 0) as precio_promedio
            FROM servicios s
            LEFT JOIN detalles_orden do ON s.id = do.servicio_id
            LEFT JOIN ordenes o ON do.orden_id = o.id
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

// ============================================
// REPORTE DE MOROSIDAD (usando detalles_orden)
// ============================================
// reporteController.js - REEMPLAZAR getReporteMorosidad

// reporteController.js - MODIFICAR getReporteMorosidad

const getReporteMorosidad = async (req, res) => {
    try {
        // ✅ Obtener fecha/hora actual del servidor
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
        console.log('🔍 [DEBUG] Fecha actual:', fechaActual, 'Hora:', horaActual);
        
        // ✅ PRIMERO: Obtener todas las órdenes pendientes con sus detalles
        const ordenesConDetalles = await sequelize.query(`
            SELECT 
                o.id as orden_id,
                o.doctor_id,
                o.total,
                o.estado,
                d.id as doctor_id,
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                do.id as detalle_id,
                do.fecha_limite,
                do.hora_limite,
                do.precio_unitario,
                do.cantidad
            FROM ordenes o
            JOIN doctores d ON o.doctor_id = d.id
            JOIN detalles_orden do ON o.id = do.orden_id
            WHERE o.estado = 'pendiente'
            AND d.activo = TRUE
        `, { type: sequelize.QueryTypes.SELECT });
        
        console.log(`📊 [DEBUG] Órdenes con detalles encontradas: ${ordenesConDetalles.length}`);
        
        // ✅ Agrupar por orden y determinar si está vencida
        const ordenesMap = new Map();
        
        for (const row of ordenesConDetalles) {
            const ordenId = row.orden_id;
            
            if (!ordenesMap.has(ordenId)) {
                ordenesMap.set(ordenId, {
                    orden_id: ordenId,
                    doctor_id: row.doctor_id,
                    doctor: row.doctor,
                    telefono: row.telefono,
                    total: parseFloat(row.total) || 0,
                    detalles: [],
                    tieneVencido: false
                });
            }
            
            const ordenData = ordenesMap.get(ordenId);
            
            // ✅ Verificar si este detalle está vencido
            let detalleVencido = false;
            if (row.fecha_limite) {
                const [year, month, day] = row.fecha_limite.split('-').map(Number);
                let horas = 23, minutos = 59, segundos = 59;
                
                if (row.hora_limite) {
                    const parts = row.hora_limite.split(':');
                    horas = parseInt(parts[0]);
                    minutos = parseInt(parts[1]);
                    segundos = 0;
                }
                
                const fechaLimite = new Date(year, month - 1, day, horas, minutos, segundos);
                const ahoraDate = new Date(fechaActual + 'T' + horaActual);
                
                if (fechaLimite.getTime() < ahoraDate.getTime()) {
                    detalleVencido = true;
                    ordenData.tieneVencido = true;
                }
            }
            
            ordenData.detalles.push({
                detalle_id: row.detalle_id,
                fecha_limite: row.fecha_limite,
                hora_limite: row.hora_limite,
                precio_unitario: parseFloat(row.precio_unitario) || 0,
                cantidad: parseInt(row.cantidad) || 1,
                vencido: detalleVencido
            });
        }
        
        // ✅ Agrupar por doctor
        const doctoresMap = new Map();
        
        for (const [ordenId, orden] of ordenesMap) {
            const doctorKey = orden.doctor_id;
            
            if (!doctoresMap.has(doctorKey)) {
                doctoresMap.set(doctorKey, {
                    doctorId: orden.doctor_id,
                    doctor: orden.doctor,
                    telefono: orden.telefono || '',
                    ordenes: [],
                    total_ordenes: 0,
                    ordenes_vencidas: 0,
                    total_facturado: 0,
                    total_pagado: 0,
                    diasMora: 0
                });
            }
            
            const doctorData = doctoresMap.get(doctorKey);
            doctorData.ordenes.push(orden);
            doctorData.total_ordenes += 1;
            
            // ✅ Calcular facturado (suma de todos los detalles)
            let facturadoOrden = 0;
            for (const det of orden.detalles) {
                facturadoOrden += det.precio_unitario * det.cantidad;
            }
            doctorData.total_facturado += facturadoOrden;
            
            // ✅ Si la orden tiene al menos un servicio vencido, contar como vencida
            if (orden.tieneVencido) {
                doctorData.ordenes_vencidas += 1;
            }
        }
        
        // ✅ Calcular pagos por doctor
        for (const [doctorKey, doctorData] of doctoresMap) {
            const pagosResult = await sequelize.query(`
                SELECT COALESCE(SUM(p.monto), 0) as total_pagado
                FROM pagos p
                JOIN ordenes o ON p.orden_id = o.id
                WHERE o.doctor_id = :doctorId
                AND o.estado = 'pendiente'
            `, { 
                replacements: { doctorId: doctorKey },
                type: sequelize.QueryTypes.SELECT 
            });
            
            doctorData.total_pagado = parseFloat(pagosResult[0]?.total_pagado) || 0;
        }
        
// reporteController.js - MODIFICAR getReporteMorosidad (solo la parte de días de mora)

// ✅ Calcular días de mora (usando FLOOR con comparación EXACTA de horas)
for (const [doctorKey, doctorData] of doctoresMap) {
    let totalDias = 0;
    let countVencidas = 0;
    
    for (const orden of doctorData.ordenes) {
        if (orden.tieneVencido) {
            // ✅ Buscar el detalle más antiguo vencido
            let fechaMasAntigua = null;
            let horaMasAntigua = null;
            
            for (const det of orden.detalles) {
                if (det.vencido && det.fecha_limite) {
                    if (!fechaMasAntigua || det.fecha_limite < fechaMasAntigua) {
                        fechaMasAntigua = det.fecha_limite;
                        horaMasAntigua = det.hora_limite || '23:59:59';
                    }
                }
            }
            
            if (fechaMasAntigua) {
                // ✅ Crear fecha límite COMPLETA con hora
                const [year, month, day] = fechaMasAntigua.split('-').map(Number);
                let horas = 23, minutos = 59, segundos = 59;
                
                if (horaMasAntigua) {
                    const parts = horaMasAntigua.split(':');
                    horas = parseInt(parts[0]);
                    minutos = parseInt(parts[1]);
                    segundos = parseInt(parts[2]) || 0;
                }
                
                const fechaLimiteCompleta = new Date(year, month - 1, day, horas, minutos, segundos);
                const ahoraCompleta = new Date(fechaActual + 'T' + horaActual);
                
                // ✅ Calcular diferencia en milisegundos y luego en días
                const diffMs = ahoraCompleta.getTime() - fechaLimiteCompleta.getTime();
                
                // ✅ Si la diferencia es positiva, calcular días completos (FLOOR)
                if (diffMs > 0) {
                    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    totalDias += diffDias;
                    countVencidas++;
                }
            }
        }
    }
    
    doctorData.diasMora = countVencidas > 0 ? Math.round(totalDias / countVencidas) : 0;
}
        
        // ✅ Convertir a array y calcular deuda
        const deudasConDeuda = Array.from(doctoresMap.values())
            .map(d => {
                const deuda = d.total_facturado - d.total_pagado;
                return {
                    doctorId: d.doctorId,
                    doctor: d.doctor,
                    telefono: d.telefono,
                    ordenes: d.total_ordenes,
                    vencidas: d.ordenes_vencidas,
                    deuda: deuda,
                    diasMora: d.diasMora
                };
            })
            .filter(d => d.deuda > 0);
        
        deudasConDeuda.sort((a, b) => b.deuda - a.deuda);
        
        const resumen = {
            deudaTotal: deudasConDeuda.reduce((sum, d) => sum + d.deuda, 0),
            clientesMorosos: deudasConDeuda.length,
            ordenesVencidas: deudasConDeuda.reduce((sum, d) => sum + d.vencidas, 0)
        };
        
        console.log('📊 [DEBUG] Resumen morosidad:', JSON.stringify(resumen, null, 2));
        console.log('📊 [DEBUG] Detalle:', JSON.stringify(deudasConDeuda, null, 2));
        
        res.json({
            detalle: deudasConDeuda,
            resumen
        });

    } catch (error) {
        logger.error('Error en reporte de morosidad:', error);
        res.status(500).json({ error: 'Error al generar reporte de morosidad' });
    }
};

// ============================================
// REPORTE DE PRODUCTIVIDAD
// ============================================
// reporteController.js - CORREGIR getReporteProductividad

const getReporteProductividad = async (req, res) => {
    try {
        const rendimiento = await sequelize.query(`
            SELECT 
                d.nombre as doctor,
                COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as completadas,
                COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as pendientes,
                ROUND(
                    (COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) * 100.0) / 
                    NULLIF(COUNT(DISTINCT o.id), 0), 2
                ) as eficiencia
            FROM doctores d
            LEFT JOIN ordenes o ON d.id = o.doctor_id
            WHERE d.activo = TRUE
            GROUP BY d.nombre
            ORDER BY eficiencia DESC, completadas DESC
        `, { type: sequelize.QueryTypes.SELECT });

        let totalCompletadas = 0;
        let totalPendientes = 0;
        
        const rendimientoProcesado = rendimiento.map(r => {
            const completadas = Number(r.completadas) || 0;
            const pendientes = Number(r.pendientes) || 0;
            
            totalCompletadas += completadas;
            totalPendientes += pendientes;
            
            return {
                doctor: r.doctor,
                completadas: completadas,
                pendientes: pendientes,
                eficiencia: Number(r.eficiencia) || 0
            };
        });
        
        const totalOrdenes = totalCompletadas + totalPendientes;
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

// ============================================
// FUNCIÓN AUXILIAR - Completadas del mes
// ============================================
async function getCompletadasMes() {
    const [result] = await sequelize.query(`
        SELECT COUNT(DISTINCT do.id) as total
        FROM detalles_orden do
        JOIN ordenes o ON do.orden_id = o.id
        WHERE o.estado = 'terminado'
        AND MONTH(o.fecha_registro) = MONTH(CURDATE())
        AND YEAR(o.fecha_registro) = YEAR(CURDATE())
    `, { type: sequelize.QueryTypes.SELECT });
    
    return result?.total || 0;
}

// ============================================
// TENDENCIA MENSUAL
// ============================================
const getTendenciaMensual = async (req, res) => {
    try {
        const tendencia = await sequelize.query(`
            SELECT 
                DATE_FORMAT(o.fecha_registro, '%Y-%m') as mes,
                MONTH(o.fecha_registro) as mes_numero,
                YEAR(o.fecha_registro) as año,
                COUNT(DISTINCT do.id) as total_ordenes,
                SUM(CASE WHEN o.estado = 'terminado' THEN 1 ELSE 0 END) as completadas
            FROM ordenes o
            LEFT JOIN detalles_orden do ON o.id = do.orden_id
            WHERE o.fecha_registro >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY YEAR(o.fecha_registro), MONTH(o.fecha_registro), DATE_FORMAT(o.fecha_registro, '%Y-%m')
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

// ============================================
// EXPORTAR A EXCEL (ACTUALIZADO)
// ============================================
const exportarReporte = async (req, res) => {
    try {
        const { tipo } = req.params;
        const workbook = new ExcelJS.Workbook();
        
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } }
        };

        if (tipo === 'todos') {
            const todos = await getTodosReportesData();
            let filename = `reportes_completos_${new Date().toISOString().split('T')[0]}.xlsx`;
            
            // Hoja de Ingresos
            if (todos.ingresos && todos.ingresos.length > 0) {
                const wsIngresos = workbook.addWorksheet('Ingresos');
                const headersIngresos = Object.keys(todos.ingresos[0]);
                wsIngresos.addRow(headersIngresos);
                wsIngresos.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.ingresos.forEach(item => wsIngresos.addRow(Object.values(item)));
                wsIngresos.columns.forEach(col => col.width = 15);
            }
            
            // Hoja de Doctores
            if (todos.doctores && todos.doctores.length > 0) {
                const wsDoctores = workbook.addWorksheet('Doctores');
                const headersDoctores = ['doctor', 'telefono', 'total_ordenes', 'ordenes_pendientes', 'ordenes_vencidas', 'total_facturado', 'total_pagado', 'deuda_total'];
                wsDoctores.addRow(headersDoctores);
                wsDoctores.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.doctores.forEach(item => wsDoctores.addRow(Object.values(item)));
                wsDoctores.columns.forEach(col => col.width = 20);
            }
            
            // Hoja de Servicios
            if (todos.servicios && todos.servicios.length > 0) {
                const wsServicios = workbook.addWorksheet('Servicios');
                const headersServicios = ['nombre', 'cantidad', 'total_facturado', 'precio_promedio'];
                wsServicios.addRow(headersServicios);
                wsServicios.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.servicios.forEach(item => wsServicios.addRow(Object.values(item)));
                wsServicios.columns.forEach(col => col.width = 25);
            }
            
            // Hoja de Morosidad
            if (todos.morosidad && todos.morosidad.length > 0) {
                const wsMorosidad = workbook.addWorksheet('Morosidad');
                const headersMorosidad = ['doctor', 'telefono', 'ordenes', 'vencidas', 'deuda', 'diasMora'];
                wsMorosidad.addRow(headersMorosidad);
                wsMorosidad.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.morosidad.forEach(item => wsMorosidad.addRow(Object.values(item)));
                wsMorosidad.columns.forEach(col => col.width = 18);
            }
            
            // Hoja de Productividad
            if (todos.productividad && todos.productividad.length > 0) {
                const wsProductividad = workbook.addWorksheet('Productividad');
                const headersProductividad = ['doctor', 'completadas', 'pendientes', 'eficiencia'];
                wsProductividad.addRow(headersProductividad);
                wsProductividad.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                todos.productividad.forEach(item => wsProductividad.addRow(Object.values(item)));
                wsProductividad.columns.forEach(col => col.width = 20);
            }
            
            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
        } else {
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
                data.forEach(item => worksheet.addRow(Object.values(item)));
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

// ============================================
// FUNCIONES AUXILIARES PARA EXPORTACIÓN
// ============================================
async function getReporteIngresosData(params) {
    const { fechaInicio, fechaFin, grupo = 'mes' } = params;
    
    let groupFormat, selectFormat;
    switch(grupo) {
        case 'dia':
            groupFormat = 'DATE(creado_en)';
            selectFormat = 'DATE(creado_en) as periodo';
            break;
        case 'semana':
            groupFormat = 'YEARWEEK(creado_en)';
            selectFormat = 'CONCAT(YEAR(creado_en), "-", WEEK(creado_en)) as periodo';
            break;
        default:
            groupFormat = 'DATE_FORMAT(creado_en, "%Y-%m")';
            selectFormat = 'DATE_FORMAT(creado_en, "%Y-%m") as periodo';
    }

    const ingresos = await sequelize.query(`
        SELECT ${selectFormat},
               SUM(CASE WHEN metodo_pago = 'efectivo' THEN monto ELSE 0 END) as efectivo,
               SUM(CASE WHEN metodo_pago = 'tarjeta' THEN monto ELSE 0 END) as tarjeta,
               SUM(CASE WHEN metodo_pago IN ('transferencia', 'yape', 'plin') THEN monto ELSE 0 END) as digital,
               SUM(monto) as total
        FROM pagos
        WHERE creado_en BETWEEN :fechaInicio AND :fechaFin
        GROUP BY ${groupFormat}
        ORDER BY periodo ASC
    `, {
        replacements: { fechaInicio: fechaInicio + ' 00:00:00', fechaFin: fechaFin + ' 23:59:59' },
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

// reporteController.js - CORREGIR getReporteDoctoresData

// reporteController.js - CORREGIR getReporteDoctoresData (misma lógica que getReporteDoctores)

// reporteController.js - CORREGIR getReporteDoctoresData (versión definitiva)

async function getReporteDoctoresData() {
    // Primero obtener datos detallados por orden
    const doctoresPorOrden = await sequelize.query(`
        SELECT 
            d.nombre as doctor,
            d.telefono_whatsapp as telefono,
            o.id as orden_id,
            COUNT(DISTINCT o.id) as total_ordenes,
            COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as ordenes_pendientes,
            COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as ordenes_terminadas,
            COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total_facturado,
            COALESCE((
                SELECT SUM(p.monto) 
                FROM pagos p 
                WHERE p.orden_id = o.id
            ), 0) as total_pagado
        FROM doctores d
        LEFT JOIN ordenes o ON d.id = o.doctor_id
        LEFT JOIN detalles_orden do ON o.id = do.orden_id
        WHERE d.activo = TRUE
        GROUP BY d.nombre, d.telefono_whatsapp, o.id
    `, { type: sequelize.QueryTypes.SELECT });

    console.log('📊 [DEBUG] Doctores por orden para Excel:', JSON.stringify(doctoresPorOrden, null, 2));

    // Agrupar por doctor
    const doctoresMap = new Map();

    for (const row of doctoresPorOrden) {
        const key = row.doctor;
        if (!doctoresMap.has(key)) {
            doctoresMap.set(key, {
                doctor: row.doctor,
                telefono: row.telefono,
                total_ordenes: 0,
                ordenes_pendientes: 0,
                ordenes_terminadas: 0,
                total_facturado: 0,
                total_pagado: 0
            });
        }

        const doctorData = doctoresMap.get(key);
        doctorData.total_ordenes += Number(row.total_ordenes) || 0;
        doctorData.ordenes_pendientes += Number(row.ordenes_pendientes) || 0;
        doctorData.ordenes_terminadas += Number(row.ordenes_terminadas) || 0;
        doctorData.total_facturado += Number(row.total_facturado) || 0;
        doctorData.total_pagado += Number(row.total_pagado) || 0;
    }

    // Convertir a array y calcular deuda
    const resultado = Array.from(doctoresMap.values()).map(d => ({
        doctor: d.doctor,
        telefono: d.telefono || '',
        total_ordenes: d.total_ordenes,
        ordenes_pendientes: d.ordenes_pendientes,
        ordenes_terminadas: d.ordenes_terminadas,
        total_facturado: d.total_facturado,
        total_pagado: d.total_pagado,
        deuda_total: d.total_facturado - d.total_pagado
    }));

    console.log('📊 [DEBUG] Resultado doctores para Excel:', JSON.stringify(resultado, null, 2));

    return resultado;
}

async function getReporteServiciosData() {
    const servicios = await sequelize.query(`
        SELECT s.nombre,
               COUNT(do.id) as cantidad,
               COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total_facturado,
               COALESCE(AVG(do.precio_unitario), 0) as precio_promedio
        FROM servicios s
        LEFT JOIN detalles_orden do ON s.id = do.servicio_id
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



// reporteController.js - CORRECTA (con Math.floor)
async function getReporteMorosidadData() {
    try {
        // ✅ Obtener fecha/hora actual del servidor
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
        console.log('🔍 [DEBUG EXPORT] Fecha actual:', fechaActual, 'Hora:', horaActual);
        
        // ✅ Obtener todas las órdenes pendientes con sus detalles
        const ordenesConDetalles = await sequelize.query(`
            SELECT 
                o.id as orden_id,
                o.doctor_id,
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                do.fecha_limite,
                do.hora_limite,
                do.precio_unitario,
                do.cantidad,
                (SELECT COALESCE(SUM(p.monto), 0) 
                 FROM pagos p 
                 WHERE p.orden_id = o.id) as total_pagado
            FROM ordenes o
            JOIN doctores d ON o.doctor_id = d.id
            JOIN detalles_orden do ON o.id = do.orden_id
            WHERE o.estado = 'pendiente'
            AND d.activo = TRUE
        `, { type: sequelize.QueryTypes.SELECT });
        
        console.log(`📊 [DEBUG EXPORT] Órdenes con detalles: ${ordenesConDetalles.length}`);
        
        // ✅ Agrupar por orden y determinar si está vencida
        const ordenesMap = new Map();
        
        for (const row of ordenesConDetalles) {
            const ordenId = row.orden_id;
            
            if (!ordenesMap.has(ordenId)) {
                ordenesMap.set(ordenId, {
                    orden_id: ordenId,
                    doctor_id: row.doctor_id,
                    doctor: row.doctor,
                    telefono: row.telefono || '',
                    total_pagado: parseFloat(row.total_pagado) || 0,
                    detalles: [],
                    tieneVencido: false
                });
            }
            
            const ordenData = ordenesMap.get(ordenId);
            
            // ✅ Verificar si este detalle está vencido
            let detalleVencido = false;
            if (row.fecha_limite) {
                const [year, month, day] = row.fecha_limite.split('-').map(Number);
                let horas = 23, minutos = 59, segundos = 59;
                
                if (row.hora_limite) {
                    const parts = row.hora_limite.split(':');
                    horas = parseInt(parts[0]);
                    minutos = parseInt(parts[1]);
                    segundos = 0;
                }
                
                const fechaLimite = new Date(year, month - 1, day, horas, minutos, segundos);
                const ahoraDate = new Date(fechaActual + 'T' + horaActual);
                
                if (fechaLimite.getTime() < ahoraDate.getTime()) {
                    detalleVencido = true;
                    ordenData.tieneVencido = true;
                }
            }
            
            ordenData.detalles.push({
                fecha_limite: row.fecha_limite,
                hora_limite: row.hora_limite,
                precio_unitario: parseFloat(row.precio_unitario) || 0,
                cantidad: parseInt(row.cantidad) || 1,
                vencido: detalleVencido
            });
        }
        
        // ✅ Agrupar por doctor
        const doctoresMap = new Map();
        
        for (const [ordenId, orden] of ordenesMap) {
            const doctorKey = orden.doctor_id;
            
            if (!doctoresMap.has(doctorKey)) {
                doctoresMap.set(doctorKey, {
                    doctor: orden.doctor,
                    telefono: orden.telefono,
                    ordenes: 0,
                    vencidas: 0,
                    total_facturado: 0,
                    total_pagado: 0,
                    diasMora: 0
                });
            }
            
            const doctorData = doctoresMap.get(doctorKey);
            doctorData.ordenes += 1;
            
            // ✅ Calcular facturado (suma de todos los detalles)
            let facturadoOrden = 0;
            for (const det of orden.detalles) {
                facturadoOrden += det.precio_unitario * det.cantidad;
            }
            doctorData.total_facturado += facturadoOrden;
            doctorData.total_pagado += orden.total_pagado;
            
            // ✅ Si la orden tiene al menos un servicio vencido, contar como vencida
            if (orden.tieneVencido) {
                doctorData.vencidas += 1;
            }
        }
        
      // reporteController.js - MODIFICAR getReporteMorosidadData (misma corrección)

// ✅ Calcular días de mora (usando FLOOR con comparación EXACTA de horas)
for (const [doctorKey, doctorData] of doctoresMap) {
    let totalDias = 0;
    let countVencidas = 0;
    
    for (const [ordenId, orden] of ordenesMap) {
        if (orden.doctor_id === doctorKey && orden.tieneVencido) {
            // Buscar el detalle más antiguo vencido
            let fechaMasAntigua = null;
            let horaMasAntigua = null;
            
            for (const det of orden.detalles) {
                if (det.vencido && det.fecha_limite) {
                    if (!fechaMasAntigua || det.fecha_limite < fechaMasAntigua) {
                        fechaMasAntigua = det.fecha_limite;
                        horaMasAntigua = det.hora_limite || '23:59:59';
                    }
                }
            }
            
            if (fechaMasAntigua) {
                // ✅ Crear fecha límite COMPLETA con hora
                const [year, month, day] = fechaMasAntigua.split('-').map(Number);
                let horas = 23, minutos = 59, segundos = 59;
                
                if (horaMasAntigua) {
                    const parts = horaMasAntigua.split(':');
                    horas = parseInt(parts[0]);
                    minutos = parseInt(parts[1]);
                    segundos = parseInt(parts[2]) || 0;
                }
                
                const fechaLimiteCompleta = new Date(year, month - 1, day, horas, minutos, segundos);
                const ahoraCompleta = new Date(fechaActual + 'T' + horaActual);
                
                // ✅ Calcular diferencia en milisegundos y luego en días
                const diffMs = ahoraCompleta.getTime() - fechaLimiteCompleta.getTime();
                
                if (diffMs > 0) {
                    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    totalDias += diffDias;
                    countVencidas++;
                }
            }
        }
    }
    
    doctorData.diasMora = countVencidas > 0 ? Math.round(totalDias / countVencidas) : 0;
}
        
        // ✅ Convertir a array y calcular deuda
        const resultado = Array.from(doctoresMap.values())
            .map(d => {
                const deuda = d.total_facturado - d.total_pagado;
                return {
                    doctor: d.doctor,
                    telefono: d.telefono || '',
                    ordenes: d.ordenes,
                    vencidas: d.vencidas,
                    deuda: deuda,
                    diasMora: d.diasMora
                };
            })
            .filter(d => d.deuda > 0);
        
        console.log('📊 [DEBUG EXPORT] Resultado morosidad para Excel:', JSON.stringify(resultado, null, 2));
        
        return resultado;
        
    } catch (error) {
        logger.error('Error en getReporteMorosidadData:', error);
        return [];
    }
}

async function getTodosReportesData() {
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

    return { ingresos, doctores, servicios, morosidad, productividad };
}

// ============================================
// EXPORTACIÓN
// ============================================

// Agregar este endpoint en reporteController.js
// reporteController.js - CORREGIR exportarReportePorDoctor
// reporteController.js - CORREGIR exportarReportePorDoctor (versión definitiva)

const exportarReportePorDoctor = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const workbook = new ExcelJS.Workbook();
        
        // ✅ Obtener datos del doctor - Usando la misma lógica que getReporteDoctores
        const doctorData = await sequelize.query(`
            SELECT 
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                d.direccion,
                COUNT(DISTINCT o.id) as total_ordenes,
                COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as ordenes_pendientes,
                COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as ordenes_terminadas,
                COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total_facturado,
                COALESCE((
                    SELECT SUM(p.monto) 
                    FROM pagos p 
                    WHERE p.orden_id = o.id
                ), 0) as total_pagado
            FROM doctores d
            LEFT JOIN ordenes o ON d.id = o.doctor_id
            LEFT JOIN detalles_orden do ON o.id = do.orden_id
            WHERE d.id = :doctorId AND d.activo = TRUE
            GROUP BY d.nombre, d.telefono_whatsapp, d.direccion
        `, { replacements: { doctorId }, type: sequelize.QueryTypes.SELECT });
        
        const doctor = doctorData[0] || {};
        
        // ✅ Obtener órdenes detalladas del doctor
        const ordenes = await sequelize.query(`
            SELECT 
                o.id_externo as orden,
                s.nombre as servicio,
                do.precio_unitario,
                do.cantidad,
                (do.precio_unitario * do.cantidad) as subtotal,
                do.fecha_limite,
                do.hora_limite,
                o.estado,
                COALESCE(do.cliente_nombre, o.cliente_nombre, '-') as cliente,
                do.detalle_cliente as detalle_servicio,
                COALESCE(p.monto_pagado, 0) as pagado_por_orden,
                (SELECT SUM(do2.precio_unitario * do2.cantidad) 
                 FROM detalles_orden do2 
                 WHERE do2.orden_id = do.orden_id) as total_orden
            FROM doctores d
            JOIN ordenes o ON d.id = o.doctor_id
            JOIN detalles_orden do ON o.id = do.orden_id
            JOIN servicios s ON do.servicio_id = s.id
            LEFT JOIN (
                SELECT orden_id, SUM(monto) as monto_pagado
                FROM pagos
                GROUP BY orden_id
            ) p ON o.id = p.orden_id
            WHERE d.id = :doctorId
            ORDER BY o.fecha_registro DESC, do.orden ASC
        `, { replacements: { doctorId }, type: sequelize.QueryTypes.SELECT });
        
        // Procesar órdenes
        const ordenesProcesadas = ordenes.map(o => {
            const subtotal = parseFloat(o.subtotal) || 0;
            const totalOrden = parseFloat(o.total_orden) || 0;
            const pagadoPorOrden = parseFloat(o.pagado_por_orden) || 0;
            
            let pagadoPorServicio = 0;
            if (totalOrden > 0 && pagadoPorOrden > 0) {
                pagadoPorServicio = (subtotal / totalOrden) * pagadoPorOrden;
            }
            
            const saldo = subtotal - pagadoPorServicio;
            
            return {
                orden: o.orden,
                servicio: o.servicio,
                precio_unitario: subtotal / (o.cantidad || 1),
                cantidad: o.cantidad || 1,
                subtotal: subtotal,
                fecha_limite: o.fecha_limite,
                hora_limite: o.hora_limite,
                estado: o.estado,
                cliente: o.cliente,
                detalle_servicio: o.detalle_servicio || '-',
                pagado: pagadoPorServicio,
                saldo: saldo
            };
        });
        
        const nombreDoctor = (doctor.doctor || `doctor_${doctorId}`).replace(/\s/g, '_');
        const filename = `reporte_doctor_${nombreDoctor}_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        // Hoja de resumen
        const wsResumen = workbook.addWorksheet('Resumen');
        const headerStyle = { 
            font: { bold: true, color: { argb: 'FFFFFFFF' } }, 
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } } 
        };
        
        const totalFacturado = Number(doctor.total_facturado) || 0;
        const totalPagado = Number(doctor.total_pagado) || 0;
        
        wsResumen.addRow(['Doctor:', doctor.doctor || 'N/A']);
        wsResumen.addRow(['Teléfono:', doctor.telefono || 'N/A']);
        wsResumen.addRow(['Dirección:', doctor.direccion || 'N/A']);
        wsResumen.addRow([]);
        
        const headers = ['Total Órdenes', 'Pendientes', 'Terminadas', 'Total Facturado', 'Total Pagado', 'Deuda Total'];
        wsResumen.addRow(headers);
        wsResumen.getRow(5).eachCell((cell) => { 
            cell.font = headerStyle.font; 
            cell.fill = headerStyle.fill; 
        });
        wsResumen.addRow([
            doctor.total_ordenes || 0,
            doctor.ordenes_pendientes || 0,
            doctor.ordenes_terminadas || 0,
            totalFacturado.toFixed(2),
            totalPagado.toFixed(2),
            (totalFacturado - totalPagado).toFixed(2)
        ]);
        
        // Hoja de detalle
        if (ordenesProcesadas.length > 0) {
            const wsDetalle = workbook.addWorksheet('Detalle de Órdenes');
            const detalleHeaders = ['Orden', 'Servicio', 'Precio', 'Cantidad', 'Subtotal', 'Fecha Límite', 'Hora', 'Estado', 'Cliente', 'Detalle Cliente', 'Pagado', 'Saldo'];
            wsDetalle.addRow(detalleHeaders);
            wsDetalle.getRow(1).eachCell((cell) => { 
                cell.font = headerStyle.font; 
                cell.fill = headerStyle.fill; 
            });
            ordenesProcesadas.forEach(o => {
                wsDetalle.addRow([
                    o.orden, o.servicio, o.precio_unitario.toFixed(2), o.cantidad, 
                    o.subtotal.toFixed(2), o.fecha_limite, o.hora_limite, o.estado, 
                    o.cliente, o.detalle_servicio, o.pagado.toFixed(2), o.saldo.toFixed(2)
                ]);
            });
            wsDetalle.columns.forEach(col => col.width = 18);
        }
        
        wsResumen.columns.forEach(col => col.width = 20);
        
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        
    } catch (error) {
        logger.error('Error exportando reporte por doctor:', error);
        res.status(500).json({ error: 'Error al exportar reporte' });
    }
};




module.exports = {
    getReporteIngresos,
    getReporteDoctores,
    getReporteServicios,
    getReporteMorosidad,
    getReporteProductividad,
    getTendenciaMensual,
    exportarReporte,
    exportarReportePorDoctor
};