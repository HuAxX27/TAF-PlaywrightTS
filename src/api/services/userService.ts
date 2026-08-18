//EXAMPLE

import { ApiClient } from "../apiClient";

export interface User {
    id: string;
    email: string;
    name: string;
}

export class UserService {
    constructor(private readonly api: ApiClient) {}

    async createUser(data: Partial<User>): Promise<User> {
        return this.api.post<User>("/api/users", data);
    }

    async deleteUser(id: string): Promise<void> {
        await this.api.delete(`/api/users/${id}`);
    }
}
