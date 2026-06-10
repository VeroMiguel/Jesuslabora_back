const { body, validationResult } = require('express-validator');

const validarCampos = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            errores: errors.array().map(err => ({
                campo: err.path,
                mensaje: err.msg
            }))
        });
    }
    next();
};

// Validadores específicos
const validarLogin = [
    body('nombre_usuario')
        .notEmpty().withMessage('El nombre de usuario es requerido')
        .isLength({ min: 3 }).withMessage('Mínimo 3 caracteres'),
    body('contrasena')
        .notEmpty().withMessage('La contraseña es requerida')
        .isLength({ min: 6 }).withMessage('Mínimo 6 caracteres'),
    validarCampos
];

const validarOrden = [
    body('doctor_id')
        .isInt().withMessage('ID de doctor inválido'),
    body('servicio_id')
        .isInt().withMessage('ID de servicio inválido'),
    body('total')
        .isFloat({ min: 0 }).withMessage('Total debe ser un número positivo'),
    body('fecha_limite')
        .optional()
        .isDate().withMessage('Fecha límite inválida'),
    validarCampos
];

const validarPago = [
    body('orden_id')
        .isInt().withMessage('ID de orden inválido'),
    body('monto')
        .isFloat({ min: 0.01 }).withMessage('Monto debe ser mayor a 0'),
    body('metodo_pago')
        .isIn(['efectivo', 'tarjeta', 'transferencia', 'yape', 'plin', 'deposito'])
        .withMessage('Método de pago inválido'),
    validarCampos
];

const validarServicio = [
    body('nombre')
        .notEmpty().withMessage('El nombre es requerido')
        .isLength({ min: 3, max: 100 }).withMessage('El nombre debe tener entre 3 y 100 caracteres'),
    body('precio_referencial')
        .optional({ nullable: true, checkFalsy: true })
        .custom((value) => {
            if (value === null || value === undefined || value === '') {
                return true;
            }
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
                throw new Error('El precio debe ser un número positivo');
            }
            return true;
        }),
    validarCampos
];

// Exportar todos los validadores
module.exports = {
    validarCampos,
    validarLogin,
    validarOrden,
    validarPago,
    validarServicio  // ✅ YA ESTÁ AQUÍ
};