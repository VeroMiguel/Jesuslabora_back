// reporteController.js - VERSIÓN CORREGIDA (sin JSON_ARRAYAGG)

const { sequelize, Doctor, Servicio, Orden, Pago, DetalleOrden } = require('../models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

// ============================================
// REPORTE DE INGRESOS
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
// REPORTE DE DOCTORES - CORREGIDO (sin JSON_ARRAYAGG)
// ============================================
const getReporteDoctores = async (req, res) => {
    try {
        const { tipo_cliente, mes } = req.query;
        
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
        console.log('🔍 [DEBUG] Filtros:', { tipo_cliente, mes });
        
        let fechaFiltro = '';
        if (mes) {
            const [year, month] = mes.split('-');
            const startDate = `${year}-${month}-01`;
            const endDate = `${year}-${month}-${new Date(year, month, 0).getDate()}`;
            fechaFiltro = `AND o.fecha_registro BETWEEN '${startDate}' AND '${endDate}'`;
        }
        
        let tipoClienteFiltro = '';
        if (tipo_cliente === 'unico') {
            tipoClienteFiltro = `AND o.cliente_nombre IS NOT NULL AND o.cliente_nombre != ''`;
        } else if (tipo_cliente === 'multiple') {
            tipoClienteFiltro = `AND (o.cliente_nombre IS NULL OR o.cliente_nombre = '')`;
        }
        
        // ✅ Obtener doctores con resumen
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
                    WHERE p.orden_id IN (
                        SELECT o2.id 
                        FROM ordenes o2 
                        WHERE o2.doctor_id = d.id
                        ${fechaFiltro}
                    )
                ), 0) as total_pagado
            FROM doctores d
            LEFT JOIN ordenes o ON d.id = o.doctor_id
            LEFT JOIN detalles_orden do ON o.id = do.orden_id
            WHERE d.activo = TRUE
            ${fechaFiltro}
            ${tipoClienteFiltro}
            GROUP BY d.id, d.nombre, d.telefono_whatsapp, d.logo_url, d.direccion
        `, { type: sequelize.QueryTypes.SELECT });
        
        console.log('📊 [DEBUG] Doctores encontrados:', doctores.length);
        
        // ✅ Obtener órdenes detalladas para cada doctor (usando GROUP_CONCAT en lugar de JSON_ARRAYAGG)
        const doctoresConOrdenes = await Promise.all(doctores.map(async (d) => {
            // ✅ Obtener órdenes del doctor con sus detalles y pagos (usando GROUP_CONCAT)
            const ordenesRaw = await sequelize.query(`
                SELECT 
                    o.id,
                    o.id_externo,
                    o.estado,
                    o.total,
                    o.fecha_registro,
                    o.cliente_nombre,
                    o.cliente_codigo,
                    o.detalle_cliente,
                    (
                        SELECT CONCAT('[', 
                            GROUP_CONCAT(
                                JSON_OBJECT(
                                    'id', do2.id,
                                    'servicio_id', do2.servicio_id,
                                    'servicio_nombre', s2.nombre,
                                    'precio_unitario', do2.precio_unitario,
                                    'cantidad', do2.cantidad,
                                    'cliente_nombre', do2.cliente_nombre,
                                    'cliente_codigo', do2.cliente_codigo,
                                    'detalle_cliente', do2.detalle_cliente,
                                    'fecha_limite', do2.fecha_limite,
                                    'hora_limite', do2.hora_limite,
                                    'imagen_referencia_url', do2.imagen_referencia_url
                                )
                            ), ']'
                        )
                        FROM detalles_orden do2
                        LEFT JOIN servicios s2 ON do2.servicio_id = s2.id
                        WHERE do2.orden_id = o.id
                        ORDER BY do2.orden ASC
                    ) as detalles_json,
                    (
                        SELECT CONCAT('[', 
                            GROUP_CONCAT(
                                JSON_OBJECT(
                                    'id', p2.id,
                                    'monto', p2.monto,
                                    'metodo_pago', p2.metodo_pago,
                                    'referencia', p2.referencia,
                                    'observaciones', p2.observaciones,
                                    'creado_en', p2.creado_en
                                )
                            ), ']'
                        )
                        FROM pagos p2
                        WHERE p2.orden_id = o.id
                        ORDER BY p2.creado_en ASC
                    ) as pagos_json
                FROM ordenes o
                WHERE o.doctor_id = :doctorId
                ${fechaFiltro.replace('AND o.', 'AND ')}
                ORDER BY o.fecha_registro DESC
            `, { 
                replacements: { doctorId: d.doctorId },
                type: sequelize.QueryTypes.SELECT 
            });
            
            // ✅ Procesar JSON (convertir strings a objetos)
            const ordenesProcesadas = ordenesRaw.map(o => {
                let detalles = [];
                let pagos = [];
                
                try {
                    if (o.detalles_json) {
                        detalles = JSON.parse(o.detalles_json);
                        // Si es null o undefined, usar array vacío
                        if (!detalles) detalles = [];
                    }
                } catch (e) {
                    console.warn('Error parseando detalles:', e.message);
                    detalles = [];
                }
                
                try {
                    if (o.pagos_json) {
                        pagos = JSON.parse(o.pagos_json);
                        if (!pagos) pagos = [];
                    }
                } catch (e) {
                    console.warn('Error parseando pagos:', e.message);
                    pagos = [];
                }
                
                return {
                    ...o,
                    detalles: detalles,
                    pagos: pagos,
                    detalles_json: undefined,
                    pagos_json: undefined
                };
            });
            
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
            
            // ✅ Calcular PRÓXIMA ENTREGA
            let proximaEntrega = null;
            
            const fechasDetalles = await sequelize.query(`
                SELECT 
                    do.fecha_limite,
                    do.hora_limite
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
                    fechaMasCercanaFutura = det.fecha_limite;
                    break;
                } else {
                    fechaMasRecienteVencida = det.fecha_limite;
                }
            }
            
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
                proxima_entrega: proximaEntrega,
                ordenes: ordenesProcesadas
            };
        }));
        
        const deudaTotal = doctoresConOrdenes.reduce((sum, d) => sum + d.deuda_total, 0);
        const totalFacturado = doctoresConOrdenes.reduce((sum, d) => sum + d.total_facturado, 0);
        const totalPagado = doctoresConOrdenes.reduce((sum, d) => sum + d.total_pagado, 0);
        
        console.log('📊 [DEBUG] Totales finales:', { totalFacturado, totalPagado, deudaTotal });
        
        res.json({
            doctores: doctoresConOrdenes,
            totalDoctores: doctoresConOrdenes.length,
            deudaTotal: deudaTotal,
            totalFacturado: totalFacturado,
            totalPagado: totalPagado
        });

    } catch (error) {
        logger.error('Error en reporte de doctores:', error);
        console.error('Error detallado:', error);
        res.status(500).json({ error: 'Error al generar reporte de doctores' });
    }
};

// ============================================
// REPORTE DE SERVICIOS
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
// REPORTE DE MOROSIDAD
// ============================================
const getReporteMorosidad = async (req, res) => {
    try {
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
        console.log('🔍 [DEBUG] Fecha actual:', fechaActual, 'Hora:', horaActual);
        
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
            
            let facturadoOrden = 0;
            for (const det of orden.detalles) {
                facturadoOrden += det.precio_unitario * det.cantidad;
            }
            doctorData.total_facturado += facturadoOrden;
            
            if (orden.tieneVencido) {
                doctorData.ordenes_vencidas += 1;
            }
        }
        
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
        
        for (const [doctorKey, doctorData] of doctoresMap) {
            let totalDias = 0;
            let countVencidas = 0;
            
            for (const orden of doctorData.ordenes) {
                if (orden.tieneVencido) {
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
// FUNCIONES DE EXPORTACIÓN (resumidas)
// ============================================
// reporteController.js - MODIFICAR exportarReporte (versión optimizada)

// reporteController.js - REEMPLAZAR exportarReporte (versión SIMPLIFICADA)

const exportarReporte = async (req, res) => {
    try {
        const { tipo } = req.params;
        const workbook = new ExcelJS.Workbook();
        
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } }
        };

        if (tipo === 'todos' || tipo === 'doctores') {
            // ✅ Obtener solo datos de doctores (más rápido)
            const doctores = await getReporteDoctoresData();
            
            let filename = `reporte_doctores_${new Date().toISOString().split('T')[0]}.xlsx`;
            
            // ✅ Hoja de Doctores
            if (doctores && doctores.length > 0) {
                const wsDoctores = workbook.addWorksheet('Doctores');
                const headersDoctores = ['doctor', 'telefono', 'total_ordenes', 'ordenes_pendientes', 
                                         'ordenes_terminadas', 'total_facturado', 'total_pagado', 'deuda_total'];
                wsDoctores.addRow(headersDoctores);
                wsDoctores.getRow(1).eachCell((cell) => {
                    cell.font = headerStyle.font;
                    cell.fill = headerStyle.fill;
                });
                doctores.forEach(item => wsDoctores.addRow(Object.values(item)));
                wsDoctores.columns.forEach(col => col.width = 20);
            } else {
                const wsDoctores = workbook.addWorksheet('Doctores');
                wsDoctores.addRow(['No hay datos de doctores']);
            }
            
            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
            return;
        }
        
        // ✅ Para otros tipos de reporte
        let data = [];
        let filename = `reporte_${tipo}_${new Date().toISOString().split('T')[0]}.xlsx`;

        switch(tipo) {
            case 'ingresos':
                data = await getReporteIngresosData({ 
                    fechaInicio: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0],
                    fechaFin: new Date().toISOString().split('T')[0],
                    grupo: 'mes' 
                });
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

async function getReporteDoctoresData() {
    const doctores = await sequelize.query(`
        SELECT 
            d.nombre as doctor,
            d.telefono_whatsapp as telefono,
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
        GROUP BY d.nombre, d.telefono_whatsapp
    `, { type: sequelize.QueryTypes.SELECT });

    return doctores.map(d => ({
        doctor: d.doctor,
        telefono: d.telefono || '',
        total_ordenes: Number(d.total_ordenes) || 0,
        ordenes_pendientes: Number(d.ordenes_pendientes) || 0,
        ordenes_terminadas: Number(d.ordenes_terminadas) || 0,
        total_facturado: Number(d.total_facturado) || 0,
        total_pagado: Number(d.total_pagado) || 0,
        deuda_total: Number(d.total_facturado) - Number(d.total_pagado)
    }));
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

async function getReporteMorosidadData() {
    try {
        const ahora = new Date();
        const fechaActual = ahora.toISOString().split('T')[0];
        const horaActual = ahora.toTimeString().slice(0, 8);
        
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
        
        const doctoresMap = new Map();
        
        for (const row of ordenesConDetalles) {
            const doctorKey = row.doctor_id;
            
            if (!doctoresMap.has(doctorKey)) {
                doctoresMap.set(doctorKey, {
                    doctor: row.doctor,
                    telefono: row.telefono || '',
                    total_facturado: 0,
                    total_pagado: 0
                });
            }
            
            const doctorData = doctoresMap.get(doctorKey);
            const precio = parseFloat(row.precio_unitario) || 0;
            const cantidad = parseInt(row.cantidad) || 1;
            doctorData.total_facturado += precio * cantidad;
            doctorData.total_pagado += parseFloat(row.total_pagado) || 0;
        }
        
        const resultado = Array.from(doctoresMap.values())
            .map(d => {
                const deuda = d.total_facturado - d.total_pagado;
                return {
                    doctor: d.doctor,
                    telefono: d.telefono || '',
                    deuda: deuda,
                    ordenes: 0,
                    vencidas: 0,
                    diasMora: 0
                };
            })
            .filter(d => d.deuda > 0);
        
        return resultado;
        
    } catch (error) {
        logger.error('Error en getReporteMorosidadData:', error);
        return [];
    }
}

async function getReporteProductividadData() {
    const rendimiento = await sequelize.query(`
        SELECT 
            d.nombre as doctor,
            COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as completadas,
            COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as pendientes
        FROM doctores d
        LEFT JOIN ordenes o ON d.id = o.doctor_id
        WHERE d.activo = TRUE
        GROUP BY d.nombre
    `, { type: sequelize.QueryTypes.SELECT });

    return rendimiento.map(r => ({
        doctor: r.doctor,
        completadas: Number(r.completadas) || 0,
        pendientes: Number(r.pendientes) || 0
    }));
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
// EXPORTAR REPORTE POR DOCTOR
// ============================================
// reporteController.js - REEMPLAZAR exportarReportePorDoctor

// reporteController.js - MODIFICAR exportarReportePorDoctor
// reporteController.js - REEMPLAZAR COMPLETAMENTE exportarReportePorDoctor

// reporteController.js - REEMPLAZAR COMPLETAMENTE exportarReportePorDoctor

const exportarReportePorDoctor = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { paciente } = req.query;
        
        const workbook = new ExcelJS.Workbook();
        
        let replacements = { doctorId };
        let pacienteFiltro = '';
        let esNumeroOrden = false;
        let ordenEspecifica = null;
        
        // ✅ DETECTAR SI EL PACIENTE ES UN NÚMERO DE ORDEN
        if (paciente && paciente.trim() !== '') {
            const pacienteTrim = paciente.trim();
            // Si empieza con ORD- es un número de orden
            if (pacienteTrim.toUpperCase().startsWith('ORD-')) {
                esNumeroOrden = true;
                
                // ✅ Buscar la orden específica
                const ordenResult = await sequelize.query(`
                    SELECT o.id, o.id_externo, o.doctor_id, o.total, o.estado
                    FROM ordenes o
                    WHERE o.id_externo = :ordenId
                `, { 
                    replacements: { ordenId: pacienteTrim },
                    type: sequelize.QueryTypes.SELECT 
                });
                
                if (ordenResult.length > 0) {
                    ordenEspecifica = ordenResult[0];
                    // ✅ Usar el doctor_id de la orden encontrada
                    replacements.doctorId = ordenEspecifica.doctor_id;
                    
                    // ✅ Filtrar SOLO por esta orden específica
                    pacienteFiltro = `
                        AND o.id = :ordenIdInterno
                    `;
                    replacements.ordenIdInterno = ordenEspecifica.id;
                } else {
                    // Si no se encuentra la orden, retornar reporte vacío
                    const wsResumen = workbook.addWorksheet('Resumen');
                    wsResumen.addRow([`No se encontró la orden "${pacienteTrim}"`]);
                    const buffer = await workbook.xlsx.writeBuffer();
                    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    res.setHeader('Content-Disposition', `attachment; filename="reporte_no_encontrado.xlsx"`);
                    res.send(buffer);
                    return;
                }
            } else {
                // ✅ Búsqueda normal por paciente
                const pacienteLower = paciente.toLowerCase();
                pacienteFiltro = `
                    AND (
                        LOWER(o.cliente_nombre) LIKE :pacienteLower
                        OR LOWER(do.cliente_nombre) LIKE :pacienteLower
                        OR LOWER(o.cliente_codigo) LIKE :pacienteCodigo
                        OR LOWER(do.cliente_codigo) LIKE :pacienteCodigo
                    )
                `;
                replacements.pacienteLower = `%${pacienteLower}%`;
                replacements.pacienteCodigo = `%${pacienteLower}%`;
            }
        }
        
        // ============================================
        // ✅ HOJA 1: RESUMEN
        // ============================================
        
        // ✅ Información del doctor
        const doctorInfo = await sequelize.query(`
            SELECT 
                d.nombre as doctor,
                d.telefono_whatsapp as telefono,
                d.direccion
            FROM doctores d
            WHERE d.id = :doctorId AND d.activo = TRUE
        `, { replacements, type: sequelize.QueryTypes.SELECT });
        
        const doctor = doctorInfo[0] || {};
        
        // ✅ Total Facturado (solo del paciente/orden filtrado)
        let facturadoQuery = `
            SELECT COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total_facturado
            FROM ordenes o
            JOIN detalles_orden do ON o.id = do.orden_id
            WHERE o.doctor_id = :doctorId
        `;
        if (pacienteFiltro) {
            facturadoQuery += pacienteFiltro;
        }
        const facturadoResult = await sequelize.query(facturadoQuery, { 
            replacements, 
            type: sequelize.QueryTypes.SELECT 
        });
        const totalFacturado = parseFloat(facturadoResult[0]?.total_facturado) || 0;
        
        // ✅ Total Pagado (solo del paciente/orden filtrado)
        let pagadoQuery = `
            SELECT COALESCE(SUM(p.monto), 0) as total_pagado
            FROM pagos p
            JOIN ordenes o ON p.orden_id = o.id
            LEFT JOIN detalles_orden do ON do.id = JSON_UNQUOTE(JSON_EXTRACT(p.observaciones, '$.detalle_id'))
            WHERE o.doctor_id = :doctorId
        `;
        if (pacienteFiltro) {
            pagadoQuery += pacienteFiltro;
        }
        const pagadoResult = await sequelize.query(pagadoQuery, { 
            replacements, 
            type: sequelize.QueryTypes.SELECT 
        });
        const totalPagado = parseFloat(pagadoResult[0]?.total_pagado) || 0;
        const deudaTotal = totalFacturado - totalPagado;
        
        // ✅ Contar órdenes (solo del paciente/orden filtrado)
        let ordenesQuery = `
            SELECT 
                COUNT(DISTINCT o.id) as total_ordenes,
                COUNT(DISTINCT CASE WHEN o.estado = 'pendiente' THEN o.id END) as ordenes_pendientes,
                COUNT(DISTINCT CASE WHEN o.estado = 'terminado' THEN o.id END) as ordenes_terminadas
            FROM ordenes o
            JOIN detalles_orden do ON o.id = do.orden_id
            WHERE o.doctor_id = :doctorId
        `;
        if (pacienteFiltro) {
            ordenesQuery += pacienteFiltro;
        }
        const ordenesResult = await sequelize.query(ordenesQuery, { 
            replacements, 
            type: sequelize.QueryTypes.SELECT 
        });
        const ordenes = ordenesResult[0] || { total_ordenes: 0, ordenes_pendientes: 0, ordenes_terminadas: 0 };
        
        // ✅ HOJA 1: RESUMEN
        const wsResumen = workbook.addWorksheet('Resumen');
        const headerStyle = { 
            font: { bold: true, color: { argb: 'FFFFFFFF' } }, 
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } } 
        };
        
        const titleStyle = {
            font: { bold: true, size: 14 },
            alignment: { horizontal: 'center' }
        };
        
        const titulo = paciente && paciente.trim() !== '' 
            ? `Reporte del Dr. ${doctor.doctor || 'N/A'} - Paciente: ${paciente}`
            : `Reporte del Dr. ${doctor.doctor || 'N/A'}`;
        
        wsResumen.addRow([titulo]);
        wsResumen.mergeCells(`A${wsResumen.rowCount}:F${wsResumen.rowCount}`);
        wsResumen.getRow(wsResumen.rowCount).getCell(1).font = titleStyle.font;
        wsResumen.addRow([]);
        
        wsResumen.addRow(['Doctor:', doctor.doctor || 'N/A']);
        wsResumen.addRow(['Teléfono:', doctor.telefono || 'N/A']);
        wsResumen.addRow(['Dirección:', doctor.direccion || 'N/A']);
        if (paciente && paciente.trim() !== '') {
            wsResumen.addRow(['Paciente filtrado:', paciente]);
        }
        wsResumen.addRow([]);
        
        const headers = ['Total Órdenes', 'Pendientes', 'Terminadas', 'Total Facturado', 'Total Pagado', 'Deuda Total'];
        wsResumen.addRow(headers);
        wsResumen.getRow(wsResumen.rowCount).eachCell((cell) => { 
            cell.font = headerStyle.font; 
            cell.fill = headerStyle.fill; 
        });
        wsResumen.addRow([
            ordenes.total_ordenes || 0,
            ordenes.ordenes_pendientes || 0,
            ordenes.ordenes_terminadas || 0,
            totalFacturado.toFixed(2),
            totalPagado.toFixed(2),
            deudaTotal.toFixed(2)
        ]);
        wsResumen.columns.forEach(col => col.width = 20);
        
        // ============================================
        // HOJA 2: DETALLE DE ÓRDENES (FILTRADO)
        // ============================================
        let detalleQuery = `
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
                COALESCE(do.cliente_codigo, o.cliente_codigo, '-') as codigo,
                (
                    SELECT COALESCE(SUM(p.monto), 0) 
                    FROM pagos p 
                    WHERE p.orden_id = o.id
                    AND JSON_UNQUOTE(JSON_EXTRACT(p.observaciones, '$.detalle_id')) = do.id
                ) as pagado_servicio
            FROM doctores d
            JOIN ordenes o ON d.id = o.doctor_id
            JOIN detalles_orden do ON o.id = do.orden_id
            JOIN servicios s ON do.servicio_id = s.id
            WHERE d.id = :doctorId
        `;
        if (pacienteFiltro) {
            detalleQuery += pacienteFiltro;
        }
        detalleQuery += ` ORDER BY o.fecha_registro DESC, do.orden ASC`;
        
        const ordenesDetalle = await sequelize.query(detalleQuery, { 
            replacements, 
            type: sequelize.QueryTypes.SELECT 
        });
        
        if (ordenesDetalle.length > 0) {
            const wsDetalle = workbook.addWorksheet('Detalle de Órdenes');
            const detalleHeaders = ['Orden', 'Servicio', 'Precio', 'Cantidad', 'Subtotal', 'Fecha Límite', 'Hora', 'Estado', 'Cliente', 'Código', 'Pagado', 'Saldo'];
            wsDetalle.addRow(detalleHeaders);
            wsDetalle.getRow(1).eachCell((cell) => { 
                cell.font = headerStyle.font; 
                cell.fill = headerStyle.fill; 
            });
            
            for (const o of ordenesDetalle) {
                const subtotal = parseFloat(o.subtotal) || 0;
                const pagadoServicio = parseFloat(o.pagado_servicio) || 0;
                const saldo = subtotal - pagadoServicio;
                
                wsDetalle.addRow([
                    o.orden || '-',
                    o.servicio || '-',
                    parseFloat(o.precio_unitario).toFixed(2) || '0.00',
                    o.cantidad || 1,
                    subtotal.toFixed(2),
                    o.fecha_limite || '-',
                    o.hora_limite || '-',
                    o.estado || '-',
                    o.cliente || '-',
                    o.codigo || '-',
                    pagadoServicio.toFixed(2),
                    saldo.toFixed(2)
                ]);
            }
            wsDetalle.columns.forEach(col => col.width = 18);
        } else {
            const wsDetalle = workbook.addWorksheet('Detalle de Órdenes');
            wsDetalle.addRow(['No hay órdenes para mostrar']);
        }
        
        // ============================================
        // HOJA 3: HISTORIAL DE PAGOS (FILTRADO)
        // ============================================
        let pagosQueryDetalle = `
            SELECT 
                p.creado_en as fecha,
                p.monto,
                p.metodo_pago,
                p.referencia,
                o.id_externo as orden,
                COALESCE(s.nombre, 'N/A') as servicio,
                COALESCE(
                    CASE 
                        WHEN do.cliente_nombre IS NOT NULL AND do.cliente_nombre != '' THEN do.cliente_nombre
                        WHEN o.cliente_nombre IS NOT NULL AND o.cliente_nombre != '' THEN o.cliente_nombre
                        ELSE NULL
                    END,
                    '-'
                ) as cliente,
                COALESCE(
                    CASE 
                        WHEN do.cliente_codigo IS NOT NULL AND do.cliente_codigo != '' THEN do.cliente_codigo
                        WHEN o.cliente_codigo IS NOT NULL AND o.cliente_codigo != '' THEN o.cliente_codigo
                        ELSE NULL
                    END,
                    '-'
                ) as codigo
            FROM pagos p
            JOIN ordenes o ON p.orden_id = o.id
            LEFT JOIN detalles_orden do ON do.id = JSON_UNQUOTE(JSON_EXTRACT(p.observaciones, '$.detalle_id'))
            LEFT JOIN servicios s ON s.id = do.servicio_id
            WHERE o.doctor_id = :doctorId
        `;
        if (pacienteFiltro) {
            pagosQueryDetalle += pacienteFiltro;
        }
        pagosQueryDetalle += ` ORDER BY p.creado_en DESC`;
        
        const pagosDetalle = await sequelize.query(pagosQueryDetalle, { 
            replacements, 
            type: sequelize.QueryTypes.SELECT 
        });
        
        if (pagosDetalle.length > 0) {
            const wsPagos = workbook.addWorksheet('Historial de Pagos');
            const pagosHeaders = ['Fecha', 'Monto', 'Método', 'Orden', 'Servicio', 'Cliente', 'Código', 'Referencia'];
            wsPagos.addRow(pagosHeaders);
            wsPagos.getRow(1).eachCell((cell) => { 
                cell.font = headerStyle.font; 
                cell.fill = headerStyle.fill; 
            });
            
            pagosDetalle.forEach(p => {
                let fechaFormateada = '-';
                if (p.fecha) {
                    try {
                        const fecha = new Date(p.fecha);
                        fechaFormateada = fecha.toLocaleString('es-PE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    } catch (e) {
                        fechaFormateada = p.fecha;
                    }
                }
                
                wsPagos.addRow([
                    fechaFormateada,
                    parseFloat(p.monto).toFixed(2),
                    p.metodo_pago || '-',
                    p.orden || '-',
                    p.servicio || '-',
                    p.cliente || '-',
                    p.codigo || '-',
                    p.referencia || '-'
                ]);
            });
            wsPagos.columns.forEach(col => col.width = 18);
        }
        
        const nombreDoctor = (doctor.doctor || `doctor_${doctorId}`).replace(/\s/g, '_');
        const pacienteSufijo = paciente && paciente.trim() !== '' ? `_${paciente.replace(/\s/g, '_')}` : '';
        const filename = `reporte_doctor_${nombreDoctor}${pacienteSufijo}_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        
    } catch (error) {
        logger.error('Error exportando reporte por doctor:', error);
        res.status(500).json({ error: 'Error al exportar reporte', details: error.message });
    }
};

// ✅ Función auxiliar para obtener total de una orden con pagos
async function getTotalOrdenConPagos(ordenId) {
    try {
        const result = await sequelize.query(`
            SELECT COALESCE(SUM(do.precio_unitario * do.cantidad), 0) as total
            FROM detalles_orden do
            WHERE do.orden_id = :ordenId
        `, { 
            replacements: { ordenId },
            type: sequelize.QueryTypes.SELECT 
        });
        return parseFloat(result[0]?.total) || 0;
    } catch (e) {
        return 0;
    }
}

// ============================================
// EXPORTACIÓN
// ============================================
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