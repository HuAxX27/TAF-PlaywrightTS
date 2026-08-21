import type { TestCase } from "../types";

/**
 * De donde salen Test Cases YA definidos (Xray, o un archivo local para demos).
 * A diferencia de StorySource, aqui no se disena nada: el TC ya viene completo
 * y el pipeline salta directo a cobertura + generacion de codigo.
 */
export interface TestCaseSource {
    readonly name: string;
    fetch(key: string): Promise<TestCase[]>;
}
