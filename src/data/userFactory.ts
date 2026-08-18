import { faker } from "@faker-js/faker";
import { User } from "../api/services/userService";

export function buildUser(overrides: Partial<User> = {}): Partial<User> {
    return{
        email: faker.internet.email(),
        name: faker.person.fullName(),
        ...overrides,
    };
}