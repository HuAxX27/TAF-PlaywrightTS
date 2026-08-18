import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// Creamos el token codificado en Base64 para la autenticación
const authHash = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

export interface UserStoryContext {
    ticketId: string;
    title: string;
    description: string;
}

export async function getUserStoryDetails(ticketId: string): Promise<UserStoryContext> {
    try {
        const response = await axios.get(`${JIRA_BASE_URL}/rest/api/2/issue/${ticketId}`, {
            headers: {
                'Authorization': `Basic ${authHash}`,
                'Accept': 'application/json'
            }
        });

        const issue = response.data;
        
        return {
            ticketId: issue.key,
            title: issue.fields.summary,
            // Dependiendo de tu configuración de Jira, la descripción puede venir como string o como Atlassian Document Format.
            // Asumiremos string para este caso, pero puede requerir limpieza.
            description: issue.fields.description || 'Sin descripción',
        };
    } catch (error) {
        console.error(`Error al obtener el ticket ${ticketId} de Jira:`, error);
        throw error;
    }
}