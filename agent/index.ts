import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getUserStoryDetails } from './jiraClient';
import { getExistingTests } from './analyzer';
import { getMissingTestCases, generatePlaywrightCode } from './codemieClient';

dotenv.config();

// Resolvemos las rutas relativas basadas en tu .env
const TESTS_DIR = path.resolve(__dirname, process.env.TESTS_DIR || '../tests');
const FIXTURES_PATH = path.resolve(__dirname, process.env.FIXTURES_PATH || '../src/fixtures/test.ts');

async function runAgent(ticketId: string) {
    console.log(`\n🚀 Iniciando Agente de Automatización para el ticket: ${ticketId}`);

    try {
        // 1. Obtener datos de Jira
        console.log('📦 Extrayendo información de Jira...');
        const userStory = await getUserStoryDetails(ticketId);
        console.log(`✅ User Story obtenida: ${userStory.title}`);

        // 2. Analizar framework existente
        console.log('🔍 Analizando cobertura actual en el framework...');
        const existingTests = getExistingTests(TESTS_DIR);
        console.log(`✅ Se encontraron ${existingTests.length} pruebas existentes en el repositorio.`);

        // 3. Obtener TCs faltantes de CodeMie
        console.log('🧠 Consultando a CodeMie por escenarios faltantes...');
        const missingTests = await getMissingTestCases(userStory, existingTests);
        
        if (!missingTests || missingTests.length === 0) {
            console.log('✅ La User Story ya está completamente cubierta por los tests actuales.');
            return;
        }

        console.log(`⚠️ Se detectaron ${missingTests.length} escenarios faltantes por automatizar.`);

        // 4. Leer el archivo de fixtures para el contexto de inyección
        const fixtureContext = fs.readFileSync(FIXTURES_PATH, 'utf-8');

        // 5. Generar código para cada TC faltante
        for (const testCase of missingTests) {
            console.log(`\n⚙️ Generando código TypeScript para: "${testCase.title}"...`);
            
            const generatedCode = await generatePlaywrightCode(testCase, fixtureContext);
            
            // Limpiar la respuesta por si CodeMie incluyó bloques de markdown (```typescript ... ```)
            const cleanCode = generatedCode.replace(/```typescript|```ts/g, '').replace(/```/g, '').trim();
            
            // Crear el nombre del archivo basado en el ticket
            const fileName = `${ticketId}-${testCase.title.replace(/\s+/g, '-').toLowerCase()}.spec.ts`;
            const filePath = path.join(TESTS_DIR, fileName);
            
            // Escribir el nuevo test en la carpeta /tests
            fs.writeFileSync(filePath, cleanCode, 'utf-8');
            console.log(`💾 Archivo guardado con éxito en: ${filePath}`);
        }

        console.log('\n🎉 Proceso de AQA completado exitosamente. Revisa tu carpeta de tests.');

    } catch (error) {
        console.error('\n❌ Hubo un error en la ejecución del agente:', error);
    }
}

// Obtener el ID del ticket desde los argumentos de la terminal
const ticketArg = process.argv[2];
if (!ticketArg) {
    console.error('⚠️ Por favor, proporciona un ID de ticket.');
    console.log('💡 Ejemplo de uso: npx tsx index.ts PROJ-123');
    process.exit(1);
}

runAgent(ticketArg);