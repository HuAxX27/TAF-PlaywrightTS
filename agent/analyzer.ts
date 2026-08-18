import * as fs from 'fs';
import * as path from 'path';

export function getExistingTests(testsDir: string): string[] {
    const existingTests: string[] = [];

    // Función recursiva para leer subcarpetas dentro de /tests
    function readDirectory(directory: string) {
        if (!fs.existsSync(directory)) {
            console.warn(`El directorio ${directory} no existe. Asumiendo 0 pruebas previas.`);
            return;
        }

        const files = fs.readdirSync(directory);

        for (const file of files) {
            const fullPath = path.join(directory, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                readDirectory(fullPath);
            } else if (fullPath.endsWith('.spec.ts')) {
                const content = fs.readFileSync(fullPath, 'utf-8');
                
                // Expresión regular para encontrar test('Nombre de la prueba') o test.describe(...)
                const testRegex = /test(?:\.describe)?\(['"`](.*?)['"`]/g;
                let match;
                
                while ((match = testRegex.exec(content)) !== null) {
                    existingTests.push(match[1]);
                }
            }
        }
    }

    readDirectory(testsDir);
    return existingTests;
}