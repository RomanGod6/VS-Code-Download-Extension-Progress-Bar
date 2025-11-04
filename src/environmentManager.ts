import * as vscode from 'vscode';

export interface Environment {
    id: string;
    name: string;
    variables: { [key: string]: EnvironmentVariable };
}

export interface EnvironmentVariable {
    key: string;
    value: string;
    isSecret: boolean;
    description?: string;
}

export class EnvironmentManager {
    private environments: Environment[] = [];
    private activeEnvironmentId: string | undefined;
    private _onDidChangeEnvironments = new vscode.EventEmitter<void>();
    public readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;

    constructor(
        private context: vscode.ExtensionContext,
        private secretStorage: vscode.SecretStorage
    ) {
        this.loadEnvironments();
    }

    private async loadEnvironments() {
        // Load non-secret environments from global state
        const saved = this.context.globalState.get<Environment[]>('apiEnvironments', []);
        this.environments = saved;

        // Load active environment
        this.activeEnvironmentId = this.context.globalState.get<string>('activeEnvironmentId');

        // Load secret values from SecretStorage
        for (const env of this.environments) {
            for (const [key, variable] of Object.entries(env.variables)) {
                if (variable.isSecret) {
                    const secretKey = `env_${env.id}_${key}`;
                    const secretValue = await this.secretStorage.get(secretKey);
                    if (secretValue) {
                        variable.value = secretValue;
                    }
                }
            }
        }
    }

    private async saveEnvironments() {
        // Save non-secret data to global state
        const toSave = this.environments.map(env => ({
            ...env,
            variables: Object.fromEntries(
                Object.entries(env.variables).map(([key, variable]) => [
                    key,
                    variable.isSecret ? { ...variable, value: '' } : variable
                ])
            )
        }));

        await this.context.globalState.update('apiEnvironments', toSave);

        // Save secret values to SecretStorage
        for (const env of this.environments) {
            for (const [key, variable] of Object.entries(env.variables)) {
                if (variable.isSecret && variable.value) {
                    const secretKey = `env_${env.id}_${key}`;
                    await this.secretStorage.store(secretKey, variable.value);
                }
            }
        }

        this._onDidChangeEnvironments.fire();
    }

    public async createEnvironment(name: string): Promise<Environment> {
        const env: Environment = {
            id: `env_${Date.now()}`,
            name,
            variables: {}
        };

        this.environments.push(env);
        await this.saveEnvironments();
        return env;
    }

    public async deleteEnvironment(id: string) {
        const env = this.environments.find(e => e.id === id);
        if (!env) return;

        // Delete all secret values
        for (const key of Object.keys(env.variables)) {
            const secretKey = `env_${id}_${key}`;
            await this.secretStorage.delete(secretKey);
        }

        this.environments = this.environments.filter(e => e.id !== id);

        if (this.activeEnvironmentId === id) {
            this.activeEnvironmentId = undefined;
            await this.context.globalState.update('activeEnvironmentId', undefined);
        }

        await this.saveEnvironments();
    }

    public async setActiveEnvironment(id: string | undefined) {
        this.activeEnvironmentId = id;
        await this.context.globalState.update('activeEnvironmentId', id);
        this._onDidChangeEnvironments.fire();
    }

    public getActiveEnvironment(): Environment | undefined {
        if (!this.activeEnvironmentId) return undefined;
        return this.environments.find(e => e.id === this.activeEnvironmentId);
    }

    public getEnvironments(): Environment[] {
        return this.environments;
    }

    public getEnvironment(id: string): Environment | undefined {
        return this.environments.find(e => e.id === id);
    }

    public async setVariable(
        environmentId: string,
        key: string,
        value: string,
        isSecret: boolean = false,
        description?: string
    ) {
        const env = this.environments.find(e => e.id === environmentId);
        if (!env) return;

        env.variables[key] = { key, value, isSecret, description };
        await this.saveEnvironments();
    }

    public async deleteVariable(environmentId: string, key: string) {
        const env = this.environments.find(e => e.id === environmentId);
        if (!env) return;

        const variable = env.variables[key];
        if (variable?.isSecret) {
            const secretKey = `env_${environmentId}_${key}`;
            await this.secretStorage.delete(secretKey);
        }

        delete env.variables[key];
        await this.saveEnvironments();
    }

    /**
     * Import variables from .env file format
     */
    public async importFromEnvFile(environmentId: string, content: string) {
        const env = this.environments.find(e => e.id === environmentId);
        if (!env) return;

        const lines = content.split('\n');
        let imported = 0;

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Parse KEY=VALUE or KEY="VALUE"
            const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (!match) continue;

            const key = match[1];
            let value = match[2].trim();

            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            // Determine if secret (common secret keywords)
            const isSecret = this.isLikelySecret(key);

            await this.setVariable(environmentId, key, value, isSecret);
            imported++;
        }

        return imported;
    }

    private isLikelySecret(key: string): boolean {
        const secretKeywords = [
            'password', 'secret', 'token', 'key', 'api_key', 'apikey',
            'auth', 'credential', 'private', 'access'
        ];

        const lowerKey = key.toLowerCase();
        return secretKeywords.some(keyword => lowerKey.includes(keyword));
    }

    /**
     * Substitute variables in text with format {{VARIABLE_NAME}}
     */
    public substituteVariables(text: string): string {
        const activeEnv = this.getActiveEnvironment();
        if (!activeEnv) return text;

        return text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (match, varName) => {
            const variable = activeEnv.variables[varName];
            return variable?.value || match;
        });
    }

    /**
     * Export environment to .env format
     */
    public exportToEnvFile(environmentId: string, includeSecrets: boolean = false): string {
        const env = this.environments.find(e => e.id === environmentId);
        if (!env) return '';

        const lines: string[] = [
            `# Environment: ${env.name}`,
            `# Exported: ${new Date().toISOString()}`,
            ''
        ];

        for (const [key, variable] of Object.entries(env.variables)) {
            if (variable.isSecret && !includeSecrets) {
                lines.push(`${key}=<SECRET_VALUE_NOT_EXPORTED>`);
            } else {
                const value = variable.value.includes(' ') || variable.value.includes('#')
                    ? `"${variable.value}"`
                    : variable.value;

                if (variable.description) {
                    lines.push(`# ${variable.description}`);
                }
                lines.push(`${key}=${value}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }
}
