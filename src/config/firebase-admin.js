const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Inicializar Firebase Admin SDK
// Para desarrollo local, usa una cuenta de servicio
// Para producción (Railway), usar variables de entorno

let serviceAccount;

if (process.env.NODE_ENV === 'production') {
    // En producción, usar variables de entorno
    serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CERT_URL
    };
} else {
    // Desarrollo local - buscar en la carpeta config
    const keyPath = path.join(__dirname, 'service-account-key.json');
    
    try {
        if (fs.existsSync(keyPath)) {
            serviceAccount = require(keyPath);
            console.log('✅ Archivo de cuenta de servicio encontrado en:', keyPath);
        } else {
            throw new Error('Archivo no encontrado');
        }
    } catch (error) {
        console.warn('⚠️ No se encontró service-account-key.json en:', keyPath);
        console.warn('Para notificaciones push, descarga el archivo de Firebase Console');
        console.warn('y colócalo en la carpeta src/config/');
    }
}

if (admin.apps.length === 0 && serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
    console.log('✅ Firebase Admin SDK inicializado');
} else if (!serviceAccount) {
    console.warn('⚠️ Firebase Admin SDK NO inicializado - falta archivo de cuenta de servicio');
}

module.exports = admin;