const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');

class FileService {
    constructor() {
        this.uploadDir = path.join(__dirname, '../../', config.uploadDir);
        this.doctoresDir = path.join(this.uploadDir, 'doctores');
         this.serviciosDir = path.join(this.uploadDir, 'servicios');
        this.ordenesDir = path.join(this.uploadDir, 'ordenes');  // <-- NUEVO
        this.tempDir = path.join(this.uploadDir, 'temp');
        
        // Asegurar que los directorios existen
        this.ensureDirectories();
    }

    ensureDirectories() {
        fs.ensureDirSync(this.doctoresDir);
            fs.ensureDirSync(this.serviciosDir);
           fs.ensureDirSync(this.ordenesDir);
        fs.ensureDirSync(this.tempDir);
    }

    // Guardar archivo y devolver la URL relativa
    async saveFile(file, subfolder = 'doctores') {
        const targetDir = path.join(this.uploadDir, subfolder);
        // Usar timestamp como nombre del archivo (sin el prefijo temp-)
        const fileName = `${Date.now()}${path.extname(file.originalname)}`;
        const filePath = path.join(targetDir, fileName);
        
        // Mover archivo del temporal al destino final
        await fs.move(file.path, filePath, { overwrite: true });
        
        // Devolver URL relativa para guardar en BD
        return `/uploads/${subfolder}/${fileName}`;
    }

    // Eliminar archivo
    async deleteFile(fileUrl) {
        if (!fileUrl) return;
        
        // Convertir URL a ruta de archivo
        const filePath = path.join(__dirname, '../../', fileUrl.replace(/^\//, ''));
        
        try {
            await fs.remove(filePath);
        } catch (error) {
            console.error('Error eliminando archivo:', error);
        }
    }

    // Obtener ruta completa del archivo
    getFilePath(fileUrl) {
        if (!fileUrl) return null;
        return path.join(__dirname, '../../', fileUrl.replace(/^\//, ''));
    }
}

module.exports = new FileService();