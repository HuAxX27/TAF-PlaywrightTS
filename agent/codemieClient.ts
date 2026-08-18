import axios from 'axios';
import * as dotenv from 'dotenv';
import { UserStoryContext } from './jiraClient';

dotenv.config();

const CODEMIE_API_KEY = process.env.CODEMIE_API_KEY;
// Usando la URL de tu entorno de laboratorio
const CODEMIE_API_URL = 'https://codemie.lab.epam.com/code-assistant-api/v1/chat/completions'; 

// 1. Definimos la interfaz para evitar el uso de "any"
export interface GeneratedTestCase {
    title: string;
    steps: string[];
    expectedResult: string;
}

async function callCodeMie(prompt: string): Promise<string> {
    try {
        const response = await axios.post(CODEMIE_API_URL, {
            model: "gpt-4o", // Ajusta el modelo si es necesario en el lab
            messages: [
                {
                    role: "system",
                    content: "Eres un Lead Quality Automation Engineer."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.2 
        }, {
            headers: {
                'Authorization': `Bearer ${CODEMIE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("Error al comunicarse con CodeMie:", error);
        throw error;
    }
}

// 2. Usamos la interfaz en lugar de any[]
export async function getMissingTestCases(userStory: UserStoryContext, existingTests: string[]): Promise<GeneratedTestCase[]> {
    const prompt = `
        Analiza la siguiente User Story:
        TICKET: ${userStory.ticketId}
        TÍTULO: ${userStory.title}
        DESCRIPCIÓN/AC: ${userStory.description}

        En nuestro framework ya existen las siguientes pruebas automatizadas:
        ${existingTests.length > 0 ? existingTests.join('\n') : 'Ninguna prueba existente.'}

        TAREA:
        Compara los Criterios de Aceptación con las pruebas existentes. Devuelve ÚNICAMENTE un JSON array con los Test Cases que FALTAN por automatizar.
        Formato requerido: [{"title": "Nombre claro de la prueba", "steps": ["Paso 1", "Paso 2"], "expectedResult": "Resultado esperado"}]
    `;

    const responseText = await callCodeMie(prompt);
    const jsonMatch = responseText.match(/\[.*\]/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}

// 3. Usamos la interfaz en lugar de any
export async function generatePlaywrightCode(missingTest: GeneratedTestCase, fixtureSnippet: string): Promise<string> {
    const prompt = `
        Escribe un test automatizado en Playwright con TypeScript para el siguiente escenario:
        ${JSON.stringify(missingTest)}

        REGLA ESTRICTA: Debes utilizar la estructura de nuestros fixtures.
        Aquí tienes un ejemplo de cómo importamos y usamos nuestros fixtures (homePage, apiClient, userService):
        
        ${fixtureSnippet}

        Devuelve ÚNICAMENTE el código TypeScript listo para ser guardado en un archivo .spec.ts, sin explicaciones adicionales.
    `;

    return await callCodeMie(prompt);
}