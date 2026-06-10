const express = require('express');
const router = express.Router();
const { 
    registrarPago, 
    obtenerPagosPorOrden,
    eliminarPago,
    actualizarPago  // <-- IMPORTAR 
} = require('../controllers/pagoController');
const { autenticar } = require('../middleware/auth');
const { validarPago } = require('../middleware/validator');

router.post('/', autenticar, validarPago, registrarPago);
router.get('/orden/:ordenId', autenticar, obtenerPagosPorOrden);
router.put('/:id', autenticar, actualizarPago);  // <-- NUEVA RUTA
router.delete('/:id', autenticar, eliminarPago);

module.exports = router;