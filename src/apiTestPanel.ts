import * as vscode from 'vscode';
import { APITester, APIRequest, APIResponse } from './apiTester';
import { EnvironmentManager, Environment } from './environmentManager';
import { CollectionsManager, Collection } from './collectionsManager';

export class APITestPanel {
    public static currentPanel: APITestPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private apiTester: APITester,
        private environmentManager: EnvironmentManager,
        private collectionsManager: CollectionsManager,
        private outputChannel: vscode.OutputChannel
    ) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getHtmlContent();

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendRequest':
                        await this.handleSendRequest(message.request);
                        break;
                    case 'loadHistory':
                        this.sendHistory();
                        break;
                    case 'loadRequest':
                        this._panel.webview.postMessage({
                            command: 'loadRequest',
                            request: message.request
                        });
                        break;
                    case 'clearHistory':
                        // TODO: Implement clear history
                        break;
                    case 'loadEnvironments':
                        this.sendEnvironments();
                        break;
                    case 'loadCollections':
                        this.sendCollections();
                        break;
                    case 'setActiveEnvironment':
                        await this.environmentManager.setActiveEnvironment(message.environmentId);
                        this.sendEnvironments();
                        vscode.window.showInformationMessage(`Environment switched successfully`);
                        break;
                    case 'saveToCollection':
                        await this.handleSaveToCollection(message.request, message.collectionId);
                        break;
                }
            },
            null,
            this._disposables
        );

        // Send initial data
        this.sendHistory();
        this.sendEnvironments();
        this.sendCollections();
    }

    public static createOrShow(
        apiTester: APITester,
        environmentManager: EnvironmentManager,
        collectionsManager: CollectionsManager,
        outputChannel: vscode.OutputChannel
    ) {
        const column = vscode.ViewColumn.One;

        if (APITestPanel.currentPanel) {
            APITestPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'apiTester',
            '🌐 API Tester',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        APITestPanel.currentPanel = new APITestPanel(panel, apiTester, environmentManager, collectionsManager, outputChannel);
    }

    private sendHistory() {
        const history = this.apiTester.getHistory();
        this._panel.webview.postMessage({
            command: 'updateHistory',
            history
        });
    }

    private async handleSendRequest(request: APIRequest) {
        this.outputChannel.appendLine(`\n🚀 Sending request: ${request.method} ${request.url}`);

        this._panel.webview.postMessage({
            command: 'requestStarted'
        });

        try {
            const response = await this.apiTester.sendRequest(request);

            this._panel.webview.postMessage({
                command: 'requestComplete',
                response: {
                    ...response,
                    headers: Object.fromEntries(
                        Object.entries(response.headers).map(([k, v]) => [k, String(v)])
                    )
                }
            });

            // Update history
            this.sendHistory();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'requestError',
                error: errorMessage
            });
        }
    }

    private sendEnvironments() {
        const environments = this.environmentManager.getEnvironments();
        const activeEnv = this.environmentManager.getActiveEnvironment();
        this._panel.webview.postMessage({
            command: 'updateEnvironments',
            environments: environments.map((env: Environment) => ({
                id: env.id,
                name: env.name,
                isActive: env.id === activeEnv?.id
            }))
        });
    }

    private sendCollections() {
        const collections = this.collectionsManager.getCollections();
        this._panel.webview.postMessage({
            command: 'updateCollections',
            collections: collections.map((col: Collection) => ({
                id: col.id,
                name: col.name,
                requestCount: col.requests.length
            }))
        });
    }

    private async handleSaveToCollection(request: APIRequest, collectionId: string) {
        try {
            this.collectionsManager.addRequestToCollection(collectionId, request);
            vscode.window.showInformationMessage(`Request saved to collection!`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to save request: ${errorMessage}`);
        }
    }

    public dispose() {
        APITestPanel.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Tester</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
        }

        .sidebar {
            width: 250px;
            background-color: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }

        .sidebar-header {
            padding: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .history-item {
            padding: 12px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .history-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .history-method {
            font-weight: 600;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            display: inline-block;
            margin-right: 8px;
        }

        .method-GET { background-color: #61affe; color: white; }
        .method-POST { background-color: #49cc90; color: white; }
        .method-PUT { background-color: #fca130; color: white; }
        .method-DELETE { background-color: #f93e3e; color: white; }
        .method-PATCH { background-color: #50e3c2; color: white; }

        .history-url {
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-top: 4px;
            opacity: 0.8;
        }

        .history-time {
            font-size: 11px;
            opacity: 0.6;
            margin-top: 4px;
        }

        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .request-panel {
            padding: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
        }

        .request-header {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .request-header-icon {
            font-size: 24px;
        }

        .request-line {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        select, input, textarea {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
        }

        select:focus, input:focus, textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        #method {
            width: 120px;
            font-weight: 600;
        }

        #url {
            flex: 1;
        }

        .send-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 30px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: background-color 0.2s;
        }

        .send-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .tabs {
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
        }

        .tab {
            padding: 8px 16px;
            background-color: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
            color: var(--vscode-foreground);
        }

        .tab:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .tab.active {
            border-bottom-color: var(--vscode-focusBorder);
            font-weight: 600;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        textarea {
            width: 100%;
            min-height: 150px;
            font-family: 'Consolas', 'Monaco', monospace;
            resize: vertical;
        }

        .response-panel {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
        }

        .response-header {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 15px;
        }

        .response-status {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 15px;
        }

        .status-success { background-color: #49cc90; color: white; }
        .status-error { background-color: #f93e3e; color: white; }
        .status-info { background-color: #61affe; color: white; }

        .response-meta {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            font-size: 13px;
        }

        .meta-item {
            display: flex;
            gap: 5px;
        }

        .meta-label {
            opacity: 0.7;
        }

        .meta-value {
            font-weight: 600;
        }

        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 13px;
            line-height: 1.5;
        }

        .loading {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-left: 10px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            opacity: 0.6;
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 10px;
        }

        .headers-grid {
            display: grid;
            grid-template-columns: 200px 1fr;
            gap: 10px;
            margin-bottom: 10px;
        }

        .header-input {
            width: 100%;
        }

        .add-header-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-top: 10px;
        }

        .control-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            align-items: center;
            padding: 12px;
            background-color: var(--vscode-sideBar-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .control-label {
            font-size: 12px;
            font-weight: 600;
            opacity: 0.8;
            white-space: nowrap;
        }

        .control-select {
            min-width: 150px;
        }

        .save-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background-color 0.2s;
            white-space: nowrap;
        }

        .save-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .variable-hint {
            font-size: 11px;
            opacity: 0.7;
            font-style: italic;
            margin-top: 8px;
            padding: 8px 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            border-left: 3px solid var(--vscode-focusBorder);
        }

        .variable-example {
            font-family: 'Consolas', 'Monaco', monospace;
            color: var(--vscode-textLink-foreground);
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">📜 Request History</div>
        <div id="history"></div>
    </div>

    <div class="main-content">
        <div class="request-panel">
            <div class="request-header">
                <span class="request-header-icon">🌐</span>
                API Tester
            </div>

            <div class="control-bar">
                <div class="control-group">
                    <span class="control-label">🌍 Environment:</span>
                    <select id="environment" class="control-select" onchange="changeEnvironment()">
                        <option value="">No environment</option>
                    </select>
                </div>
                <div class="control-group">
                    <span class="control-label">📁 Collection:</span>
                    <select id="collection" class="control-select">
                        <option value="">Select collection...</option>
                    </select>
                    <button class="save-button" onclick="saveToCollection()">💾 Save</button>
                </div>
            </div>

            <div class="variable-hint">
                💡 Tip: Use <span class="variable-example">{{VARIABLE}}</span> in URL, headers, or body to substitute environment variables
            </div>

            <div class="request-line">
                <select id="method">
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                    <option>PATCH</option>
                    <option>HEAD</option>
                    <option>OPTIONS</option>
                </select>
                <input type="text" id="url" placeholder="https://api.example.com/endpoint" value="https://jsonplaceholder.typicode.com/posts/1">
                <button class="send-button" onclick="sendRequest()" id="sendBtn">Send</button>
            </div>

            <div class="tabs">
                <button class="tab active" onclick="switchTab('headers')">Headers</button>
                <button class="tab" onclick="switchTab('body')">Body</button>
            </div>

            <div id="headers-content" class="tab-content active">
                <div id="headers-grid" class="headers-grid">
                    <input type="text" class="header-input" placeholder="Content-Type" value="Content-Type">
                    <input type="text" class="header-input" placeholder="application/json" value="application/json">
                    <input type="text" class="header-input" placeholder="User-Agent" value="User-Agent">
                    <input type="text" class="header-input" placeholder="VS Code Toolbox" value="VS Code Toolbox">
                </div>
                <button class="add-header-btn" onclick="addHeader()">+ Add Header</button>
            </div>

            <div id="body-content" class="tab-content">
                <textarea id="body" placeholder='{"key": "value"}'></textarea>
            </div>
        </div>

        <div class="response-panel">
            <div id="response-container"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentTab = 'headers';

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'updateHistory':
                    renderHistory(message.history);
                    break;
                case 'requestStarted':
                    showLoading();
                    break;
                case 'requestComplete':
                    showResponse(message.response);
                    break;
                case 'requestError':
                    showError(message.error);
                    break;
                case 'loadRequest':
                    loadRequest(message.request);
                    break;
                case 'updateEnvironments':
                    renderEnvironments(message.environments);
                    break;
                case 'updateCollections':
                    renderCollections(message.collections);
                    break;
            }
        });

        function switchTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById(tab + '-content').classList.add('active');
        }

        function addHeader() {
            const grid = document.getElementById('headers-grid');
            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.className = 'header-input';
            keyInput.placeholder = 'Header name';

            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.className = 'header-input';
            valueInput.placeholder = 'Header value';

            grid.appendChild(keyInput);
            grid.appendChild(valueInput);
        }

        function getHeaders() {
            const grid = document.getElementById('headers-grid');
            const inputs = grid.querySelectorAll('input');
            const headers = {};

            for (let i = 0; i < inputs.length; i += 2) {
                const key = inputs[i].value.trim();
                const value = inputs[i + 1].value.trim();
                if (key && value) {
                    headers[key] = value;
                }
            }

            return headers;
        }

        function sendRequest() {
            const method = document.getElementById('method').value;
            const url = document.getElementById('url').value;
            const body = document.getElementById('body').value;
            const headers = getHeaders();

            if (!url) {
                alert('Please enter a URL');
                return;
            }

            const request = {
                id: Date.now().toString(),
                name: method + ' ' + url,
                method,
                url,
                headers,
                body: body || undefined,
                timestamp: Date.now()
            };

            vscode.postMessage({ command: 'sendRequest', request });
        }

        function showLoading() {
            document.getElementById('sendBtn').disabled = true;
            document.getElementById('response-container').innerHTML = \`
                <div style="text-align: center; padding: 40px;">
                    <div class="loading"></div>
                    <p style="margin-top: 20px;">Sending request...</p>
                </div>
            \`;
        }

        function showResponse(response) {
            document.getElementById('sendBtn').disabled = false;

            const statusClass = response.status >= 200 && response.status < 300 ? 'status-success' :
                              response.status >= 400 ? 'status-error' : 'status-info';

            let formattedBody = response.body;
            try {
                const parsed = JSON.parse(response.body);
                formattedBody = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // Not JSON, keep as is
            }

            document.getElementById('response-container').innerHTML = \`
                <div class="response-header">Response</div>
                <div class="response-status \${statusClass}">\${response.status} \${response.statusText}</div>
                <div class="response-meta">
                    <div class="meta-item">
                        <span class="meta-label">Time:</span>
                        <span class="meta-value">\${response.duration}ms</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Size:</span>
                        <span class="meta-value">\${formatBytes(response.body.length)}</span>
                    </div>
                </div>
                <div class="tabs" style="margin-top: 20px;">
                    <button class="tab active" onclick="switchResponseTab('response-body')">Body</button>
                    <button class="tab" onclick="switchResponseTab('response-headers')">Headers</button>
                </div>
                <div id="response-body" class="tab-content active">
                    <pre><code>\${escapeHtml(formattedBody)}</code></pre>
                </div>
                <div id="response-headers" class="tab-content">
                    <pre><code>\${escapeHtml(JSON.stringify(response.headers, null, 2))}</code></pre>
                </div>
            \`;
        }

        function switchResponseTab(tabId) {
            document.querySelectorAll('#response-container .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#response-container .tab-content').forEach(c => c.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        }

        function showError(error) {
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('response-container').innerHTML = \`
                <div class="response-header">Error</div>
                <div class="response-status status-error">Request Failed</div>
                <pre><code>\${escapeHtml(error)}</code></pre>
            \`;
        }

        function renderHistory(history) {
            const container = document.getElementById('history');

            if (!history || history.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div>No requests yet</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = history.map(item => \`
                <div class="history-item" onclick="loadHistoryItem('\${item.id}')">
                    <div>
                        <span class="history-method method-\${item.method}">\${item.method}</span>
                        <span>\${item.name}</span>
                    </div>
                    <div class="history-url">\${item.url}</div>
                    <div class="history-time">\${formatTime(item.timestamp)}</div>
                </div>
            \`).join('');
        }

        function loadHistoryItem(id) {
            vscode.postMessage({ command: 'loadRequest', request: id });
        }

        function loadRequest(request) {
            document.getElementById('method').value = request.method;
            document.getElementById('url').value = request.url;
            document.getElementById('body').value = request.body || '';

            // Load headers
            const grid = document.getElementById('headers-grid');
            grid.innerHTML = '';

            Object.entries(request.headers || {}).forEach(([key, value]) => {
                const keyInput = document.createElement('input');
                keyInput.type = 'text';
                keyInput.className = 'header-input';
                keyInput.value = key;

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'header-input';
                valueInput.value = value;

                grid.appendChild(keyInput);
                grid.appendChild(valueInput);
            });
        }

        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleString();
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        function escapeHtml(text) {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function renderEnvironments(environments) {
            const select = document.getElementById('environment');
            select.innerHTML = '<option value="">No environment</option>';

            environments.forEach(env => {
                const option = document.createElement('option');
                option.value = env.id;
                option.textContent = env.name + (env.isActive ? ' ✓' : '');
                option.selected = env.isActive;
                select.appendChild(option);
            });
        }

        function renderCollections(collections) {
            const select = document.getElementById('collection');
            select.innerHTML = '<option value="">Select collection...</option>';

            collections.forEach(col => {
                const option = document.createElement('option');
                option.value = col.id;
                option.textContent = \`\${col.name} (\${col.requestCount})\`;
                select.appendChild(option);
            });
        }

        function changeEnvironment() {
            const environmentId = document.getElementById('environment').value;
            if (environmentId) {
                vscode.postMessage({
                    command: 'setActiveEnvironment',
                    environmentId: environmentId
                });
            }
        }

        function saveToCollection() {
            const collectionId = document.getElementById('collection').value;
            if (!collectionId) {
                alert('Please select a collection first');
                return;
            }

            const method = document.getElementById('method').value;
            const url = document.getElementById('url').value;
            const body = document.getElementById('body').value;
            const headers = getHeaders();

            if (!url) {
                alert('Please enter a URL');
                return;
            }

            const request = {
                id: Date.now().toString(),
                name: method + ' ' + url,
                method,
                url,
                headers,
                body: body || undefined,
                timestamp: Date.now()
            };

            vscode.postMessage({
                command: 'saveToCollection',
                request: request,
                collectionId: collectionId
            });
        }

        // Load initial data on start
        vscode.postMessage({ command: 'loadHistory' });
        vscode.postMessage({ command: 'loadEnvironments' });
        vscode.postMessage({ command: 'loadCollections' });
    </script>
</body>
</html>`;
    }
}
