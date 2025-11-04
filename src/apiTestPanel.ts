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
                    case 'loadCollectionRequest':
                        const collection = this.collectionsManager.getCollections().find(c => c.id === message.collectionId);
                        const request = collection?.requests.find(r => r.id === message.requestId);
                        if (request) {
                            this._panel.webview.postMessage({
                                command: 'loadRequest',
                                request: request
                            });
                        }
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
                        vscode.window.showInformationMessage(`Environment switched to: ${message.environmentName || 'None'}`);
                        break;
                    case 'saveToCollection':
                        await this.handleSaveToCollection(message.request, message.collectionId);
                        this.sendCollections(); // Refresh collections after save
                        break;
                    case 'createCollection':
                        vscode.commands.executeCommand('toolbox.createCollection');
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
            APITestPanel.currentPanel.sendHistory();
            APITestPanel.currentPanel.sendEnvironments();
            APITestPanel.currentPanel.sendCollections();
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
                requests: col.requests,
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
    <title>API Tester - Postman Style</title>
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
            flex-direction: column;
            overflow: hidden;
        }

        /* Top Bar - Postman Style */
        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 15px;
        }

        .top-bar-left {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .top-bar-title {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .top-bar-right {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .env-selector {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .env-label {
            font-size: 12px;
            opacity: 0.8;
        }

        select {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
        }

        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .history-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .history-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Main Container */
        .main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        /* Collections Sidebar - Postman Style */
        .collections-sidebar {
            width: 280px;
            background-color: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
        }

        .sidebar-header {
            padding: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            font-size: 13px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .new-collection-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        .collections-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }

        .collection-item {
            margin-bottom: 10px;
        }

        .collection-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: 500;
            font-size: 13px;
        }

        .collection-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .collection-icon {
            font-size: 14px;
            transition: transform 0.2s;
        }

        .collection-icon.expanded {
            transform: rotate(90deg);
        }

        .collection-requests {
            margin-left: 20px;
            margin-top: 5px;
            display: none;
        }

        .collection-requests.show {
            display: block;
        }

        .request-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            margin-bottom: 3px;
        }

        .request-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .request-method {
            font-weight: 600;
            font-size: 10px;
            padding: 2px 5px;
            border-radius: 3px;
            min-width: 40px;
            text-align: center;
        }

        .method-GET { background-color: #61affe; color: white; }
        .method-POST { background-color: #49cc90; color: white; }
        .method-PUT { background-color: #fca130; color: white; }
        .method-DELETE { background-color: #f93e3e; color: white; }
        .method-PATCH { background-color: #50e3c2; color: white; }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            opacity: 0.6;
            font-size: 12px;
        }

        /* Request Panel */
        .request-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .request-builder {
            padding: 20px;
            background-color: var(--vscode-editor-background);
        }

        .request-line {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        #method {
            width: 120px;
            font-weight: 600;
        }

        input[type="text"], textarea {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
        }

        input[type="text"]:focus, textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
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

        .save-controls {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            align-items: center;
        }

        .save-label {
            font-size: 12px;
            opacity: 0.8;
        }

        .save-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }

        .tabs {
            display: flex;
            gap: 5px;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 15px;
        }

        .tab {
            padding: 10px 18px;
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

        .headers-grid {
            display: grid;
            grid-template-columns: 200px 1fr auto;
            gap: 10px;
            margin-bottom: 10px;
        }

        .header-input {
            width: 100%;
        }

        .remove-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
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

        textarea {
            width: 100%;
            min-height: 150px;
            font-family: 'Consolas', 'Monaco', monospace;
            resize: vertical;
        }

        /* Response Panel */
        .response-panel {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
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

        /* History Modal */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
        }

        .modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            width: 90%;
            max-width: 800px;
            max-height: 80%;
            display: flex;
            flex-direction: column;
        }

        .modal-header {
            padding: 15px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modal-title {
            font-size: 16px;
            font-weight: 600;
        }

        .close-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }

        .close-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }

        .history-item {
            padding: 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 10px;
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

        .history-url {
            font-size: 13px;
            margin-top: 5px;
            opacity: 0.9;
        }

        .history-time {
            font-size: 11px;
            opacity: 0.6;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <!-- Top Bar -->
    <div class="top-bar">
        <div class="top-bar-left">
            <div class="top-bar-title">
                <span>🌐</span>
                <span>API Tester</span>
            </div>
        </div>
        <div class="top-bar-right">
            <div class="env-selector">
                <span class="env-label">Environment:</span>
                <select id="environment" onchange="changeEnvironment()">
                    <option value="">No Environment</option>
                </select>
            </div>
            <button class="history-btn" onclick="showHistoryModal()">
                📜 History
            </button>
        </div>
    </div>

    <!-- Main Container -->
    <div class="main-container">
        <!-- Collections Sidebar -->
        <div class="collections-sidebar">
            <div class="sidebar-header">
                <span>📁 Collections</span>
                <button class="new-collection-btn" onclick="createNewCollection()">+ New</button>
            </div>
            <div class="collections-list" id="collections-list">
                <div class="empty-state">
                    <div>No collections yet</div>
                    <div style="margin-top: 10px; font-size: 11px;">Create a collection to organize your requests</div>
                </div>
            </div>
        </div>

        <!-- Request Panel -->
        <div class="request-panel">
            <div class="request-builder">
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
                    <input type="text" id="url" placeholder="https://api.example.com/endpoint">
                    <button class="send-button" onclick="sendRequest()" id="sendBtn">Send</button>
                </div>

                <div class="save-controls">
                    <span class="save-label">Save to:</span>
                    <select id="save-collection" style="min-width: 200px;">
                        <option value="">Select collection...</option>
                    </select>
                    <button class="save-button" onclick="saveToCollection()">💾 Save Request</button>
                </div>

                <div class="tabs">
                    <button class="tab active" onclick="switchTab('headers')">Headers</button>
                    <button class="tab" onclick="switchTab('body')">Body</button>
                </div>

                <div id="headers-content" class="tab-content active">
                    <div id="headers-grid" class="headers-grid">
                        <input type="text" class="header-input" placeholder="Header name" value="Content-Type">
                        <input type="text" class="header-input" placeholder="Header value" value="application/json">
                        <button class="remove-btn" onclick="this.parentElement.remove()">×</button>
                    </div>
                    <button class="add-header-btn" onclick="addHeader()">+ Add Header</button>
                </div>

                <div id="body-content" class="tab-content">
                    <textarea id="body" placeholder='{"key": "value"}'></textarea>
                </div>
            </div>

            <div class="response-panel" id="response-container">
                <div class="empty-state">
                    <div style="font-size: 48px; margin-bottom: 10px;">🚀</div>
                    <div>Send a request to see the response</div>
                    <div style="margin-top: 10px; font-size: 11px; opacity: 0.7;">
                        Use {{VARIABLE}} syntax to substitute environment variables
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- History Modal -->
    <div id="historyModal" class="modal" onclick="closeHistoryModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-title">📜 Request History</div>
                <button class="close-btn" onclick="closeHistoryModal()">&times;</button>
            </div>
            <div class="modal-body" id="history-list">
                <div class="empty-state">No requests yet</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentTab = 'headers';
        let collectionsData = [];

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
                    collectionsData = message.collections;
                    renderCollections(message.collections);
                    renderCollectionSelector(message.collections);
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

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.onclick = function() {
                keyInput.remove();
                valueInput.remove();
                removeBtn.remove();
            };

            grid.appendChild(keyInput);
            grid.appendChild(valueInput);
            grid.appendChild(removeBtn);
        }

        function getHeaders() {
            const grid = document.getElementById('headers-grid');
            const inputs = grid.querySelectorAll('input');
            const headers = {};

            for (let i = 0; i < inputs.length; i += 2) {
                const key = inputs[i].value.trim();
                const value = inputs[i + 1] ? inputs[i + 1].value.trim() : '';
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
                <div class="tabs">
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
                <div class="response-status status-error">Request Failed</div>
                <pre><code>\${escapeHtml(error)}</code></pre>
            \`;
        }

        function renderEnvironments(environments) {
            const select = document.getElementById('environment');
            select.innerHTML = '<option value="">No Environment</option>';

            environments.forEach(env => {
                const option = document.createElement('option');
                option.value = env.id;
                option.textContent = env.name + (env.isActive ? ' ✓' : '');
                option.selected = env.isActive;
                select.appendChild(option);
            });
        }

        function renderCollections(collections) {
            const container = document.getElementById('collections-list');

            if (!collections || collections.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div>No collections yet</div>
                        <div style="margin-top: 10px; font-size: 11px;">Create a collection to organize your requests</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = collections.map(col => \`
                <div class="collection-item">
                    <div class="collection-header" onclick="toggleCollection('\${col.id}')">
                        <span class="collection-icon" id="icon-\${col.id}">▶</span>
                        <span>📁 \${col.name}</span>
                        <span style="opacity: 0.6; font-size: 11px; margin-left: auto;">(\${col.requestCount})</span>
                    </div>
                    <div class="collection-requests" id="requests-\${col.id}">
                        \${col.requests && col.requests.length > 0 ? col.requests.map(req => \`
                            <div class="request-item" onclick="loadCollectionRequest('\${col.id}', '\${req.id}')">
                                <span class="request-method method-\${req.method}">\${req.method}</span>
                                <span>\${req.name || req.url}</span>
                            </div>
                        \`).join('') : '<div class="empty-state" style="padding: 20px 10px;">No requests</div>'}
                    </div>
                </div>
            \`).join('');
        }

        function renderCollectionSelector(collections) {
            const select = document.getElementById('save-collection');
            select.innerHTML = '<option value="">Select collection...</option>';

            collections.forEach(col => {
                const option = document.createElement('option');
                option.value = col.id;
                option.textContent = col.name;
                select.appendChild(option);
            });
        }

        function toggleCollection(collectionId) {
            const requestsDiv = document.getElementById('requests-' + collectionId);
            const icon = document.getElementById('icon-' + collectionId);

            if (requestsDiv.classList.contains('show')) {
                requestsDiv.classList.remove('show');
                icon.classList.remove('expanded');
            } else {
                requestsDiv.classList.add('show');
                icon.classList.add('expanded');
            }
        }

        function loadCollectionRequest(collectionId, requestId) {
            vscode.postMessage({
                command: 'loadCollectionRequest',
                collectionId: collectionId,
                requestId: requestId
            });
        }

        function changeEnvironment() {
            const select = document.getElementById('environment');
            const environmentId = select.value;
            const environmentName = select.options[select.selectedIndex].text.replace(' ✓', '');

            vscode.postMessage({
                command: 'setActiveEnvironment',
                environmentId: environmentId,
                environmentName: environmentName
            });
        }

        function saveToCollection() {
            const collectionId = document.getElementById('save-collection').value;
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

        function createNewCollection() {
            vscode.postMessage({ command: 'createCollection' });
        }

        // History Modal
        function showHistoryModal() {
            document.getElementById('historyModal').classList.add('show');
            vscode.postMessage({ command: 'loadHistory' });
        }

        function closeHistoryModal(event) {
            if (!event || event.target.id === 'historyModal') {
                document.getElementById('historyModal').classList.remove('show');
            }
        }

        function renderHistory(history) {
            const container = document.getElementById('history-list');

            if (!history || history.length === 0) {
                container.innerHTML = '<div class="empty-state">No requests yet</div>';
                return;
            }

            container.innerHTML = history.map(item => \`
                <div class="history-item" onclick="loadHistoryItem('\${item.id}'); closeHistoryModal();">
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

                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-btn';
                removeBtn.textContent = '×';
                removeBtn.onclick = function() {
                    keyInput.remove();
                    valueInput.remove();
                    removeBtn.remove();
                };

                grid.appendChild(keyInput);
                grid.appendChild(valueInput);
                grid.appendChild(removeBtn);
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

        // Load initial data
        vscode.postMessage({ command: 'loadHistory' });
        vscode.postMessage({ command: 'loadEnvironments' });
        vscode.postMessage({ command: 'loadCollections' });
    </script>
</body>
</html>`;
    }
}
