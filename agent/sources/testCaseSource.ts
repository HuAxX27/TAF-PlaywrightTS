import type { TestCase } from "../types";

/**
 * De donde salen Test Cases YA definidos (Xray, o un archivo local para demos).
 * Aqui no se diseña nada: el Test Case de Xray ya viene completo
 * y el pipeline salta directo a cobertura + generacion de codigo.
 */
export interface TestCaseSource {
    readonly name: string;
    fetch(key: string): Promise<TestCase[]>;
}
