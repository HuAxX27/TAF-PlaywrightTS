import type { TestCase } from "../types";

/**
 * Contrato de la única entrada funcional: Test Cases ya definidos en Xray.
 * Aquí no se diseñan requisitos; la fuente entrega el TC normalizado.
 */
export interface TestCaseSource {
    readonly name: string;
    fetch(key: string): Promise<TestCase[]>;
}
