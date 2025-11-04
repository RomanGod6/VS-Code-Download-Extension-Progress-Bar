import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { EnvironmentManager } from './environmentManager';

export interface APIRequest {
    id: string;
    name: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
    url: string;
    headers: { [key: string]: string };
    body?: string;
    timestamp?: number;
}

export interface APIResponse {
    status: number;
    statusText: string;
    headers: { [key: string]: string | string[] | undefined };
    body: string;
    duration: number;
}

export class APITester {
    private requestHistory: APIRequest[] = [];
    private savedCollections: Map<string, APIRequest[]> = new Map();

    constructor(
        private outputChannel: vscode.OutputChannel,
        private context: vscode.ExtensionContext,
        private environmentManager?: EnvironmentManager
    ) {
        this.loadHistory();
    }

    private loadHistory() {
        const saved = this.context.globalState.get<APIRequest[]>('apiRequestHistory', []);
        this.requestHistory = saved;
    }

    private async saveHistory() {
        await this.context.globalState.update('apiRequestHistory', this.requestHistory);
    }

    /**
     * Send an API request (with environment variable substitution)
     */
    public async sendRequest(request: APIRequest): Promise<APIResponse> {
        const startTime = Date.now();

        // Substitute environment variables
        let processedRequest = request;
        if (this.environmentManager) {
            processedRequest = {
                ...request,
                url: this.environmentManager.substituteVariables(request.url),
                headers: Object.fromEntries(
                    Object.entries(request.headers).map(([key, value]) => [
                        key,
                        this.environmentManager!.substituteVariables(value)
                    ])
                ),
                body: request.body ? this.environmentManager.substituteVariables(request.body) : undefined
            };
        }

        this.outputChannel.appendLine(`\n=== API Request ===`);
        this.outputChannel.appendLine(`${processedRequest.method} ${processedRequest.url}`);
        this.outputChannel.appendLine(`Headers: ${JSON.stringify(processedRequest.headers, null, 2)}`);
        if (processedRequest.body) {
            this.outputChannel.appendLine(`Body: ${processedRequest.body}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const urlObj = new URL(processedRequest.url);
                const protocol = urlObj.protocol === 'https:' ? https : http;

                const options: http.RequestOptions = {
                    method: processedRequest.method,
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname + urlObj.search,
                    headers: processedRequest.headers
                };

                const req = protocol.request(options, (res) => {
                    let responseBody = '';

                    res.on('data', (chunk) => {
                        responseBody += chunk;
                    });

                    res.on('end', () => {
                        const duration = Date.now() - startTime;

                        const response: APIResponse = {
                            status: res.statusCode || 0,
                            statusText: res.statusMessage || '',
                            headers: res.headers,
                            body: responseBody,
                            duration
                        };

                        this.outputChannel.appendLine(`\n=== API Response ===`);
                        this.outputChannel.appendLine(`Status: ${response.status} ${response.statusText}`);
                        this.outputChannel.appendLine(`Duration: ${duration}ms`);
                        this.outputChannel.appendLine(`Body: ${responseBody.substring(0, 1000)}${responseBody.length > 1000 ? '...' : ''}`);

                        // Add to history
                        request.timestamp = Date.now();
                        this.requestHistory.unshift(request);
                        if (this.requestHistory.length > 100) {
                            this.requestHistory = this.requestHistory.slice(0, 100);
                        }
                        this.saveHistory();

                        resolve(response);
                    });
                });

                req.on('error', (error) => {
                    this.outputChannel.appendLine(`✗ Request error: ${error.message}`);
                    reject(error);
                });

                // Send body if present
                if (processedRequest.body) {
                    req.write(processedRequest.body);
                }

                req.end();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                this.outputChannel.appendLine(`✗ Error: ${errorMessage}`);
                reject(error);
            }
        });
    }

    /**
     * Interactive API request builder
     */
    public async buildAndSendRequest() {
        // Get method
        const method = await vscode.window.showQuickPick(
            ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
            { placeHolder: 'Select HTTP method' }
        );
        if (!method) return;

        // Get URL
        const url = await vscode.window.showInputBox({
            prompt: 'Enter API URL',
            placeHolder: 'https://api.example.com/endpoint',
            validateInput: (value) => {
                try {
                    new URL(value);
                    return null;
                } catch {
                    return 'Please enter a valid URL';
                }
            }
        });
        if (!url) return;

        // Build request
        const request: APIRequest = {
            id: Date.now().toString(),
            name: `${method} ${new URL(url).pathname}`,
            method: method as any,
            url,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'VS Code Toolbox API Tester'
            }
        };

        // Add custom headers
        const addHeaders = await vscode.window.showQuickPick(
            ['Yes', 'No'],
            { placeHolder: 'Add custom headers?' }
        );

        if (addHeaders === 'Yes') {
            const headersInput = await vscode.window.showInputBox({
                prompt: 'Enter headers as JSON',
                placeHolder: '{"Authorization": "Bearer token", "Custom-Header": "value"}',
                value: JSON.stringify(request.headers, null, 2)
            });

            if (headersInput) {
                try {
                    request.headers = JSON.parse(headersInput);
                } catch {
                    vscode.window.showErrorMessage('Invalid JSON for headers');
                    return;
                }
            }
        }

        // Add body for POST/PUT/PATCH
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
            const bodyInput = await vscode.window.showInputBox({
                prompt: 'Enter request body (JSON)',
                placeHolder: '{"key": "value"}'
            });

            if (bodyInput) {
                request.body = bodyInput;
            }
        }

        // Send request
        try {
            const response = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Sending ${method} request to ${url}`,
                    cancellable: false
                },
                async () => await this.sendRequest(request)
            );

            // Show response
            await this.showResponse(request, response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`API request failed: ${errorMessage}`);
        }
    }

    /**
     * Auto-detect API calls from the current file
     */
    public async detectAPIsInFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const document = editor.document;
        const text = document.getText();

        const apis = this.extractAPIsFromCode(text);

        if (apis.length === 0) {
            vscode.window.showInformationMessage('No API calls detected in the current file');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            apis.map(api => ({
                label: `${api.method} ${api.url}`,
                description: api.line ? `Line ${api.line}` : undefined,
                api
            })),
            { placeHolder: 'Select an API to test' }
        );

        if (selected) {
            const request: APIRequest = {
                id: Date.now().toString(),
                name: selected.label,
                method: selected.api.method,
                url: selected.api.url,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'VS Code Toolbox API Tester'
                }
            };

            try {
                const response = await this.sendRequest(request);
                await this.showResponse(request, response);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`API request failed: ${errorMessage}`);
            }
        }
    }

    private extractAPIsFromCode(code: string): Array<{ method: any; url: string; line?: number }> {
        const apis: Array<{ method: any; url: string; line?: number }> = [];

        // Patterns to detect API calls
        const patterns = [
            // fetch('url')
            /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g,
            // axios.get('url'), axios.post('url'), etc.
            /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
            // fetch('url', {method: 'POST'})
            /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{[^}]*method:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/g,
            // $.ajax({url: 'url', method: 'GET'})
            /\$\.ajax\s*\(\s*\{[^}]*url:\s*['"`]([^'"`]+)['"`][^}]*method:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/g
        ];

        const lines = code.split('\n');

        lines.forEach((line, lineNumber) => {
            // fetch() pattern
            const fetchMatches = [...line.matchAll(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g)];
            fetchMatches.forEach(match => {
                const url = match[1];
                if (url.startsWith('http')) {
                    apis.push({ method: 'GET', url, line: lineNumber + 1 });
                }
            });

            // axios pattern
            const axiosMatches = [...line.matchAll(/axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g)];
            axiosMatches.forEach(match => {
                const method = match[1].toUpperCase();
                const url = match[2];
                if (url.startsWith('http')) {
                    apis.push({ method: method as any, url, line: lineNumber + 1 });
                }
            });
        });

        return apis;
    }

    /**
     * Show API response in a webview
     */
    private async showResponse(request: APIRequest, response: APIResponse) {
        const panel = vscode.window.createWebviewPanel(
            'apiResponse',
            `API Response: ${request.method} ${request.url}`,
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        let formattedBody = response.body;
        let bodyLanguage = 'plaintext';

        // Try to format JSON
        try {
            const parsed = JSON.parse(response.body);
            formattedBody = JSON.stringify(parsed, null, 2);
            bodyLanguage = 'json';
        } catch {
            // Not JSON, keep as is
        }

        panel.webview.html = this.getResponseHTML(request, response, formattedBody, bodyLanguage);
    }

    private getResponseHTML(request: APIRequest, response: APIResponse, formattedBody: string, language: string): string {
        const statusColor = response.status >= 200 && response.status < 300 ? '#4CAF50' :
                          response.status >= 400 ? '#F44336' : '#FF9800';

        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .section {
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
        }
        .status {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 3px;
            background-color: ${statusColor};
            color: white;
            font-weight: bold;
        }
        h2 {
            margin-top: 0;
            color: var(--vscode-editor-foreground);
        }
        pre {
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 3px;
            overflow-x: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .header-item {
            margin: 5px 0;
        }
        .header-key {
            color: var(--vscode-symbolIcon-propertyForeground);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="section">
        <h2>Request</h2>
        <p><strong>${request.method}</strong> ${request.url}</p>
        <p><span class="status">${response.status} ${response.statusText}</span></p>
        <p><strong>Duration:</strong> ${response.duration}ms</p>
    </div>

    <div class="section">
        <h2>Response Headers</h2>
        ${Object.entries(response.headers).map(([key, value]) =>
            `<div class="header-item"><span class="header-key">${key}:</span> ${value}</div>`
        ).join('')}
    </div>

    <div class="section">
        <h2>Response Body</h2>
        <pre><code>${this.escapeHtml(formattedBody)}</code></pre>
    </div>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public getHistory(): APIRequest[] {
        return this.requestHistory;
    }
}
