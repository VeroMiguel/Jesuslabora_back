const express = require('express');
const router = express.Router();
const { 
    getReporteIngresos,
    getReporteDoctores,
    getReporteServicios,
    getReporteMorosidad,
    getReporteProductividad,
    exportarReporte,
    getTendenciaMensual
} = require('../controllers/reporteController');
const { autenticar } = require('../middleware/auth');

router.get('/ingresos', autenticar, getReporteIngresos);
router.get('/doctores', autenticar, getReporteDoctores);
router.get('/servicios', autenticar, getReporteServicios);
router.get('/morosidad', autenticar, getReporteMorosidad);
router.get('/productividad', autenticar, getReporteProductividad);
router.get('/exportar/:tipo', autenticar, exportarReporte);
router.get('/tendencia-mensual', autenticar, getTendenciaMensual);
module.exports = router;