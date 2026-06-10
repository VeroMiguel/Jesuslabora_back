const express = require('express');
const router = express.Router();
const { login, verificarToken, cambiarContrasena } = require('../controllers/authController');
const { autenticar } = require('../middleware/auth');
const { validarLogin } = require('../middleware/validator');
// Rutas de autenticación
router.post('/login', validarLogin, login);
router.get('/verificar', autenticar, verificarToken);
router.post('/cambiar-contrasena', autenticar, cambiarContrasena);
module.exports = router;
