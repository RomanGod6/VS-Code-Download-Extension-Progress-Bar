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

        // Listen to collection changes to auto-refresh
        this._disposables.push(
            this.collectionsManager.onDidChangeCollections(() => {
                this.sendCollections();
            })
        );

        // Listen to environment changes to auto-refresh
        this._disposables.push(
            this.environmentManager.onDidChangeEnvironments(() => {
                this.sendEnvironments();
            })
        );

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
                        await vscode.commands.executeCommand('toolbox.createCollection');
                        // Collections will auto-refresh via event listener
                        break;
                    case 'createEnvironment':
                        await this.handleCreateEnvironment(message.name, message.variables);
                        break;
                    case 'getEnvironmentVariables':
                        await this.handleGetEnvironmentVariables(message.environmentId);
                        break;
                    case 'updateEnvironmentVariables':
                        await this.handleUpdateEnvironmentVariables(message.environmentId, message.variables);
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

    private async handleCreateEnvironment(name: string, variables: { key: string; value: string; isSecret: boolean }[]) {
        try {
            const env = await this.environmentManager.createEnvironment(name);

            // Add variables to the environment
            for (const variable of variables) {
                if (variable.key && variable.value) {
                    await this.environmentManager.setVariable(env.id, variable.key, variable.value, variable.isSecret);
                }
            }

            vscode.window.showInformationMessage(`Environment "${name}" created successfully!`);
            this.sendEnvironments(); // Refresh environments list
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to create environment: ${errorMessage}`);
        }
    }

    private async handleGetEnvironmentVariables(environmentId: string) {
        try {
            const environments = this.environmentManager.getEnvironments();
            const env = environments.find(e => e.id === environmentId);

            if (env) {
                // Convert variables object to array for the UI
                const variablesArray = Object.entries(env.variables).map(([key, variable]) => ({
                    key: variable.key,
                    value: variable.value,
                    isSecret: variable.isSecret
                }));

                this._panel.webview.postMessage({
                    command: 'loadEnvironmentVariables',
                    variables: variablesArray
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load environment variables: ${errorMessage}`);
        }
    }

    private async handleUpdateEnvironmentVariables(environmentId: string, variables: { key: string; value: string; isSecret: boolean }[]) {
        try {
            // Clear existing variables
            const env = this.environmentManager.getEnvironments().find(e => e.id === environmentId);
            if (env) {
                // Remove all existing variables
                for (const key of Object.keys(env.variables)) {
                    await this.environmentManager.deleteVariable(environmentId, key);
                }

                // Add new variables
                for (const variable of variables) {
                    if (variable.key) {
                        await this.environmentManager.setVariable(environmentId, variable.key, variable.value, variable.isSecret);
                    }
                }

                vscode.window.showInformationMessage('Environment variables updated successfully!');
                this.sendEnvironments();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to update environment variables: ${errorMessage}`);
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

        .env-add-btn, .env-edit-btn {
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-left: 6px;
            transition: all 0.2s;
        }

        .env-add-btn:hover, .env-edit-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        /* Tabs Bar */
        .tabs-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 15px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            overflow-x: auto;
        }

        .request-tabs {
            display: flex;
            gap: 5px;
            flex: 1;
            overflow-x: auto;
        }

        .request-tab {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px 4px 0 0;
            cursor: pointer;
            font-size: 12px;
            min-width: 150px;
            transition: all 0.2s;
        }

        .request-tab:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .request-tab.active {
            background-color: var(--vscode-editor-background);
            border-bottom-color: var(--vscode-editor-background);
            font-weight: 600;
        }

        .tab-method {
            font-weight: 600;
            font-size: 10px;
            padding: 2px 5px;
            border-radius: 3px;
            min-width: 40px;
            text-align: center;
        }

        .tab-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tab-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 0 4px;
            font-size: 16px;
            opacity: 0.6;
            transition: opacity 0.2s;
        }

        .tab-close:hover {
            opacity: 1;
            color: var(--vscode-errorForeground);
        }

        .new-tab-btn {
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }

        .new-tab-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
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

        /* Context Menu */
        .context-menu {
            position: fixed;
            background-color: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            padding: 4px 0;
            z-index: 10000;
            min-width: 180px;
        }

        .context-menu-item {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--vscode-menu-foreground);
        }

        .context-menu-item:hover {
            background-color: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
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
                <button class="env-add-btn" onclick="showAddEnvironmentModal()" title="Add Environment">+</button>
                <button class="env-edit-btn" id="env-edit-btn" onclick="showEditEnvironmentModal()" title="Edit Environment" style="display: none;">👁️</button>
            </div>
            <button class="history-btn" onclick="showHistoryModal()">
                📜 History
            </button>
        </div>
    </div>

    <!-- Tabs Bar -->
    <div class="tabs-bar" id="tabs-bar">
        <div class="request-tabs" id="request-tabs">
            <div class="request-tab active" data-tab-id="default">
                <span class="tab-method">GET</span>
                <span class="tab-name">New Request</span>
                <button class="tab-close" onclick="closeTab(event, 'default')" style="display: none;">×</button>
            </div>
        </div>
        <button class="new-tab-btn" onclick="createNewTab()" title="New Request">+</button>
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

    <!-- Add Environment Modal -->
    <div id="addEnvironmentModal" class="modal" onclick="closeAddEnvironmentModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-title">🌍 Create Environment</div>
                <button class="close-btn" onclick="closeAddEnvironmentModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Environment Name:</label>
                    <input type="text" id="env-name" placeholder="e.g., Development, Production" style="width: 100%;">
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Variables:</label>
                    <div id="env-variables-grid" style="display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 10px; margin-bottom: 10px;">
                        <input type="text" class="env-var-key" placeholder="Variable name" value="API_KEY">
                        <input type="text" class="env-var-value" placeholder="Variable value" value="">
                        <label style="display: flex; align-items: center; gap: 5px; font-size: 12px;">
                            <input type="checkbox" class="env-var-secret" checked>
                            <span>Secret</span>
                        </label>
                        <button class="remove-btn" onclick="this.parentElement.querySelectorAll('input, label').forEach(el => el.remove()); this.remove();">×</button>
                    </div>
                    <button class="add-header-btn" onclick="addEnvironmentVariable()">+ Add Variable</button>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button class="save-button" onclick="closeAddEnvironmentModal()">Cancel</button>
                    <button class="send-button" onclick="createEnvironment()">Create Environment</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Environment Modal -->
    <div id="editEnvironmentModal" class="modal" onclick="closeEditEnvironmentModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-title">⚙️ Edit Environment</div>
                <button class="close-btn" onclick="closeEditEnvironmentModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Environment: <span id="edit-env-name" style="color: var(--vscode-focusBorder);"></span></label>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Variables:</label>
                    <div id="edit-env-variables-grid" style="display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 10px; margin-bottom: 10px;">
                    </div>
                    <button class="add-header-btn" onclick="addEditEnvironmentVariable()">+ Add Variable</button>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button class="save-button" onclick="closeEditEnvironmentModal()">Cancel</button>
                    <button class="send-button" onclick="saveEnvironmentChanges()">Save Changes</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Context Menu -->
    <div id="contextMenu" class="context-menu" style="display: none;">
        <div class="context-menu-item" onclick="handleContextMenuAction('addRequest')">
            <span>➕ Add Request</span>
        </div>
        <div class="context-menu-item" onclick="handleContextMenuAction('renameCollection')">
            <span>✏️ Rename</span>
        </div>
        <div class="context-menu-item" onclick="handleContextMenuAction('deleteCollection')">
            <span>🗑️ Delete</span>
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
                case 'loadEnvironmentVariables':
                    populateEnvironmentEditor(message.variables);
                    break;
            }
        });

        function populateEnvironmentEditor(variables) {
            const grid = document.getElementById('edit-env-variables-grid');
            grid.innerHTML = '';

            variables.forEach(variable => {
                const keyInput = document.createElement('input');
                keyInput.type = 'text';
                keyInput.className = 'env-var-key';
                keyInput.value = variable.key;

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'env-var-value';
                valueInput.value = variable.isSecret ? '••••••••' : variable.value;
                valueInput.dataset.originalValue = variable.value;

                const secretLabel = document.createElement('label');
                secretLabel.style.display = 'flex';
                secretLabel.style.alignItems = 'center';
                secretLabel.style.gap = '5px';
                secretLabel.style.fontSize = '12px';

                const secretCheckbox = document.createElement('input');
                secretCheckbox.type = 'checkbox';
                secretCheckbox.className = 'env-var-secret';
                secretCheckbox.checked = variable.isSecret;

                // When secret is checked, mask the value
                secretCheckbox.addEventListener('change', function() {
                    if (this.checked) {
                        if (valueInput.value !== '••••••••') {
                            valueInput.dataset.originalValue = valueInput.value;
                        }
                        valueInput.value = '••••••••';
                        valueInput.type = 'password';
                    } else {
                        valueInput.value = valueInput.dataset.originalValue || '';
                        valueInput.type = 'text';
                    }
                });

                // Reveal value when typing in a masked field
                valueInput.addEventListener('focus', function() {
                    if (this.value === '••••••••') {
                        this.value = this.dataset.originalValue || '';
                        this.type = 'text';
                    }
                });

                const secretSpan = document.createElement('span');
                secretSpan.textContent = 'Secret';

                secretLabel.appendChild(secretCheckbox);
                secretLabel.appendChild(secretSpan);

                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-btn';
                removeBtn.textContent = '×';
                removeBtn.onclick = function() {
                    keyInput.remove();
                    valueInput.remove();
                    secretLabel.remove();
                    removeBtn.remove();
                };

                grid.appendChild(keyInput);
                grid.appendChild(valueInput);
                grid.appendChild(secretLabel);
                grid.appendChild(removeBtn);
            });
        }

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

        // Environment Modal Functions
        function showAddEnvironmentModal() {
            document.getElementById('addEnvironmentModal').classList.add('show');
        }

        function closeAddEnvironmentModal(event) {
            if (!event || event.target.id === 'addEnvironmentModal') {
                document.getElementById('addEnvironmentModal').classList.remove('show');
                // Reset form
                document.getElementById('env-name').value = '';
                document.getElementById('env-variables-grid').innerHTML = \`
                    <input type="text" class="env-var-key" placeholder="Variable name" value="API_KEY">
                    <input type="text" class="env-var-value" placeholder="Variable value" value="">
                    <label style="display: flex; align-items: center; gap: 5px; font-size: 12px;">
                        <input type="checkbox" class="env-var-secret" checked>
                        <span>Secret</span>
                    </label>
                    <button class="remove-btn" onclick="this.parentElement.querySelectorAll('input, label').forEach(el => el.remove()); this.remove();">×</button>
                \`;
            }
        }

        function addEnvironmentVariable() {
            const grid = document.getElementById('env-variables-grid');

            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.className = 'env-var-key';
            keyInput.placeholder = 'Variable name';

            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.className = 'env-var-value';
            valueInput.placeholder = 'Variable value';

            const secretLabel = document.createElement('label');
            secretLabel.style.display = 'flex';
            secretLabel.style.alignItems = 'center';
            secretLabel.style.gap = '5px';
            secretLabel.style.fontSize = '12px';

            const secretCheckbox = document.createElement('input');
            secretCheckbox.type = 'checkbox';
            secretCheckbox.className = 'env-var-secret';

            const secretSpan = document.createElement('span');
            secretSpan.textContent = 'Secret';

            secretLabel.appendChild(secretCheckbox);
            secretLabel.appendChild(secretSpan);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.onclick = function() {
                keyInput.remove();
                valueInput.remove();
                secretLabel.remove();
                removeBtn.remove();
            };

            grid.appendChild(keyInput);
            grid.appendChild(valueInput);
            grid.appendChild(secretLabel);
            grid.appendChild(removeBtn);
        }

        function createEnvironment() {
            const name = document.getElementById('env-name').value.trim();
            if (!name) {
                alert('Please enter an environment name');
                return;
            }

            const grid = document.getElementById('env-variables-grid');
            const keys = grid.querySelectorAll('.env-var-key');
            const values = grid.querySelectorAll('.env-var-value');
            const secrets = grid.querySelectorAll('.env-var-secret');

            const variables = [];
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i].value.trim();
                const value = values[i].value.trim();
                const isSecret = secrets[i].checked;

                if (key && value) {
                    variables.push({ key, value, isSecret });
                }
            }

            vscode.postMessage({
                command: 'createEnvironment',
                name: name,
                variables: variables
            });

            closeAddEnvironmentModal();
        }

        // Environment Editor Functions
        let currentEnvironmentId = null;

        function showEditEnvironmentModal() {
            const select = document.getElementById('environment');
            const environmentId = select.value;
            if (!environmentId) return;

            currentEnvironmentId = environmentId;
            const environmentName = select.options[select.selectedIndex].text.replace(' ✓', '');

            document.getElementById('edit-env-name').textContent = environmentName;

            // Request environment details from backend
            vscode.postMessage({
                command: 'getEnvironmentVariables',
                environmentId: environmentId
            });

            document.getElementById('editEnvironmentModal').classList.add('show');
        }

        function closeEditEnvironmentModal(event) {
            if (!event || event.target.id === 'editEnvironmentModal') {
                document.getElementById('editEnvironmentModal').classList.remove('show');
                currentEnvironmentId = null;
            }
        }

        function addEditEnvironmentVariable() {
            const grid = document.getElementById('edit-env-variables-grid');

            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.className = 'env-var-key';
            keyInput.placeholder = 'Variable name';

            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.className = 'env-var-value';
            valueInput.placeholder = 'Variable value';

            const secretLabel = document.createElement('label');
            secretLabel.style.display = 'flex';
            secretLabel.style.alignItems = 'center';
            secretLabel.style.gap = '5px';
            secretLabel.style.fontSize = '12px';

            const secretCheckbox = document.createElement('input');
            secretCheckbox.type = 'checkbox';
            secretCheckbox.className = 'env-var-secret';

            const secretSpan = document.createElement('span');
            secretSpan.textContent = 'Secret';

            secretLabel.appendChild(secretCheckbox);
            secretLabel.appendChild(secretSpan);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.onclick = function() {
                keyInput.remove();
                valueInput.remove();
                secretLabel.remove();
                removeBtn.remove();
            };

            grid.appendChild(keyInput);
            grid.appendChild(valueInput);
            grid.appendChild(secretLabel);
            grid.appendChild(removeBtn);
        }

        function saveEnvironmentChanges() {
            if (!currentEnvironmentId) return;

            const grid = document.getElementById('edit-env-variables-grid');
            const keys = grid.querySelectorAll('.env-var-key');
            const values = grid.querySelectorAll('.env-var-value');
            const secrets = grid.querySelectorAll('.env-var-secret');

            const variables = [];
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i].value.trim();
                const value = values[i].value.trim();
                const isSecret = secrets[i].checked;

                if (key) {
                    variables.push({ key, value, isSecret });
                }
            }

            vscode.postMessage({
                command: 'updateEnvironmentVariables',
                environmentId: currentEnvironmentId,
                variables: variables
            });

            closeEditEnvironmentModal();
        }

        // Tab Management
        let tabs = [{ id: 'default', method: 'GET', name: 'New Request', request: null }];
        let activeTabId = 'default';

        function createNewTab() {
            const tabId = 'tab_' + Date.now();
            tabs.push({ id: tabId, method: 'GET', name: 'New Request', request: null });
            renderTabs();
            switchToTab(tabId);
        }

        function closeTab(event, tabId) {
            event.stopPropagation();
            if (tabs.length === 1) return; // Keep at least one tab

            const index = tabs.findIndex(t => t.id === tabId);
            if (index === -1) return;

            tabs.splice(index, 1);

            if (activeTabId === tabId) {
                // Switch to previous or first tab
                activeTabId = tabs[Math.max(0, index - 1)].id;
            }

            renderTabs();
            loadTabContent(activeTabId);
        }

        function switchToTab(tabId) {
            // Save current tab state before switching
            saveCurrentTabState();

            activeTabId = tabId;
            renderTabs();
            loadTabContent(tabId);
        }

        function saveCurrentTabState() {
            const tab = tabs.find(t => t.id === activeTabId);
            if (!tab) return;

            tab.method = document.getElementById('method').value;
            tab.name = document.getElementById('url').value || 'New Request';
            tab.request = {
                method: document.getElementById('method').value,
                url: document.getElementById('url').value,
                headers: getHeaders(),
                body: document.getElementById('body').value
            };
        }

        function loadTabContent(tabId) {
            const tab = tabs.find(t => t.id === tabId);
            if (!tab || !tab.request) {
                // Clear form
                document.getElementById('method').value = tab?.method || 'GET';
                document.getElementById('url').value = '';
                document.getElementById('body').value = '';
                return;
            }

            document.getElementById('method').value = tab.request.method;
            document.getElementById('url').value = tab.request.url;
            document.getElementById('body').value = tab.request.body || '';

            // Load headers
            const grid = document.getElementById('headers-grid');
            grid.innerHTML = '';

            Object.entries(tab.request.headers || {}).forEach(([key, value]) => {
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

        function renderTabs() {
            const container = document.getElementById('request-tabs');
            container.innerHTML = tabs.map(tab => \`
                <div class="request-tab \${tab.id === activeTabId ? 'active' : ''}" onclick="switchToTab('\${tab.id}')">
                    <span class="tab-method method-\${tab.method}">\${tab.method}</span>
                    <span class="tab-name">\${truncate(tab.name, 20)}</span>
                    \${tabs.length > 1 ? \`<button class="tab-close" onclick="closeTab(event, '\${tab.id}')">×</button>\` : ''}
                </div>
            \`).join('');
        }

        function truncate(str, length) {
            if (!str || str.length <= length) return str || 'New Request';
            return str.substring(0, length) + '...';
        }

        // Context Menu
        let contextMenuTarget = null;

        function showContextMenu(event, collectionId) {
            event.preventDefault();
            event.stopPropagation();

            contextMenuTarget = collectionId;
            const menu = document.getElementById('contextMenu');
            menu.style.display = 'block';
            menu.style.left = event.pageX + 'px';
            menu.style.top = event.pageY + 'px';
        }

        function handleContextMenuAction(action) {
            document.getElementById('contextMenu').style.display = 'none';

            switch(action) {
                case 'addRequest':
                    // Create new tab and associate with collection
                    const tabId = 'tab_' + Date.now();
                    tabs.push({
                        id: tabId,
                        method: 'GET',
                        name: 'New Request',
                        request: null,
                        collectionId: contextMenuTarget
                    });
                    renderTabs();
                    switchToTab(tabId);
                    break;
                case 'renameCollection':
                    // TODO: Implement rename
                    alert('Rename feature coming soon!');
                    break;
                case 'deleteCollection':
                    // TODO: Implement delete
                    if (confirm('Delete this collection?')) {
                        alert('Delete feature coming soon!');
                    }
                    break;
            }

            contextMenuTarget = null;
        }

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', function() {
            document.getElementById('contextMenu').style.display = 'none';
        });

        // Update environment selector to show/hide edit button
        function changeEnvironment() {
            const select = document.getElementById('environment');
            const environmentId = select.value;
            const environmentName = select.options[select.selectedIndex].text.replace(' ✓', '');
            const editBtn = document.getElementById('env-edit-btn');

            if (environmentId) {
                editBtn.style.display = 'inline-block';
            } else {
                editBtn.style.display = 'none';
            }

            vscode.postMessage({
                command: 'setActiveEnvironment',
                environmentId: environmentId,
                environmentName: environmentName
            });
        }

        // Update renderCollections to include context menu
        function renderCollectionsOriginal(collections) {
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
                    <div class="collection-header" onclick="toggleCollection('\${col.id}')" oncontextmenu="showContextMenu(event, '\${col.id}')">
                        <span class="collection-icon" id="icon-\${col.id}">▶</span>
                        <span>📁 \${col.name}</span>
                        <span style="opacity: 0.6; font-size: 11px; margin-left: auto;">(\${col.requestCount})</span>
                    </div>
                    <div class="collection-requests" id="requests-\${col.id}">
                        \${col.requests && col.requests.length > 0 ? col.requests.map(req => \`
                            <div class="request-item" onclick="loadCollectionRequestToTab('\${col.id}', '\${req.id}')">
                                <span class="request-method method-\${req.method}">\${req.method}</span>
                                <span>\${req.name || req.url}</span>
                            </div>
                        \`).join('') : '<div class="empty-state" style="padding: 20px 10px;">No requests</div>'}
                    </div>
                </div>
            \`).join('');
        }

        // Override renderCollections
        const originalRenderCollections = renderCollections;
        renderCollections = renderCollectionsOriginal;

        function loadCollectionRequestToTab(collectionId, requestId) {
            // Create new tab with the request
            const tabId = 'tab_' + Date.now();
            tabs.push({
                id: tabId,
                method: 'GET',
                name: 'Loading...',
                request: null,
                collectionId: collectionId,
                requestId: requestId
            });
            renderTabs();
            switchToTab(tabId);

            // Load the request
            vscode.postMessage({
                command: 'loadCollectionRequest',
                collectionId: collectionId,
                requestId: requestId
            });
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
