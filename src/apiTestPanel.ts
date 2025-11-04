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
                    case 'addDraftToCollection':
                        await this.handleAddDraftToCollection(message.request, message.collectionId);
                        break;
                    case 'setCollectionAuthorization':
                        await this.handleSetCollectionAuthorization(message.collectionId, message.authorization);
                        break;
                    case 'getCollectionAuthorization':
                        await this.handleGetCollectionAuthorization(message.collectionId);
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

    private async handleAddDraftToCollection(request: APIRequest, collectionId: string) {
        try {
            // Add the draft request immediately to collection
            this.collectionsManager.addRequestToCollection(collectionId, request);
            // Collections will auto-refresh via event listener
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to add request: ${errorMessage}`);
        }
    }

    private collectionAuthorizations: Map<string, any> = new Map();

    private async handleSetCollectionAuthorization(collectionId: string, authorization: any) {
        try {
            // Store the collection authorization in memory
            this.collectionAuthorizations.set(collectionId, authorization);

            // Optionally persist to workspace state or secret storage
            const context = (global as any).extensionContext;
            if (context) {
                const allAuths = Object.fromEntries(this.collectionAuthorizations);
                await context.workspaceState.update('collectionAuthorizations', allAuths);
            }

            vscode.window.showInformationMessage('Collection authorization set successfully!');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to set collection authorization: ${errorMessage}`);
        }
    }

    private async handleGetCollectionAuthorization(collectionId: string) {
        try {
            const authorization = this.collectionAuthorizations.get(collectionId);
            this._panel.webview.postMessage({
                command: 'loadCollectionAuthorization',
                collectionId: collectionId,
                authorization: authorization || { type: 'none' }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to get collection authorization: ${errorMessage}`);
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
                <button class="env-add-btn" onclick="showManageEnvironmentsModal()" title="Manage Environments">⚙️</button>
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
                    <button class="save-button" onclick="saveCurrentRequest()" id="saveBtn" title="Save Request">💾 Save</button>
                    <button class="send-button" onclick="sendRequest()" id="sendBtn">Send</button>
                </div>

                <div class="tabs">
                    <button class="tab active" onclick="switchTab('params')">Params</button>
                    <button class="tab" onclick="switchTab('authorization')">Authorization</button>
                    <button class="tab" onclick="switchTab('headers')">Headers</button>
                    <button class="tab" onclick="switchTab('body')">Body</button>
                </div>

                <div id="params-content" class="tab-content active">
                    <div id="params-grid" class="headers-grid">
                        <input type="text" class="param-key" placeholder="Key">
                        <input type="text" class="param-value" placeholder="Value">
                        <button class="remove-btn" onclick="this.parentElement.querySelectorAll('.param-key, .param-value').forEach(el => el.remove()); this.remove();">×</button>
                    </div>
                    <button class="add-header-btn" onclick="addParam()">+ Add Parameter</button>
                </div>

                <div id="authorization-content" class="tab-content">
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600;">Type:</label>
                        <select id="auth-type" onchange="changeAuthType()" style="width: 100%; max-width: 300px;">
                            <option value="inherit">Inherit from Collection</option>
                            <option value="none">No Auth</option>
                            <option value="bearer">Bearer Token</option>
                            <option value="basic">Basic Auth</option>
                            <option value="apikey">API Key</option>
                        </select>
                    </div>

                    <div id="auth-fields"></div>
                </div>

                <div id="headers-content" class="tab-content">
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
        <div class="context-menu-item" onclick="handleContextMenuAction('setAuthorization')">
            <span>🔐 Set Authorization</span>
        </div>
        <div class="context-menu-item" onclick="handleContextMenuAction('renameCollection')">
            <span>✏️ Rename</span>
        </div>
        <div class="context-menu-item" onclick="handleContextMenuAction('deleteCollection')">
            <span>🗑️ Delete</span>
        </div>
    </div>

    <!-- Collection Authorization Modal -->
    <div id="collectionAuthModal" class="modal" onclick="closeCollectionAuthModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-title">🔐 Set Collection Authorization</div>
                <button class="close-btn" onclick="closeCollectionAuthModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Collection: <span id="collection-auth-name" style="color: var(--vscode-focusBorder);"></span></label>
                    <p style="font-size: 12px; opacity: 0.7; margin-top: 5px;">All requests in this collection set to "Inherit from Collection" will use this authorization.</p>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Type:</label>
                    <select id="collection-auth-type" onchange="changeCollectionAuthType()" style="width: 100%; max-width: 300px;">
                        <option value="none">No Auth</option>
                        <option value="bearer">Bearer Token</option>
                        <option value="basic">Basic Auth</option>
                        <option value="apikey">API Key</option>
                    </select>
                </div>

                <div id="collection-auth-fields"></div>

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button class="save-button" onclick="closeCollectionAuthModal()">Cancel</button>
                    <button class="send-button" onclick="saveCollectionAuthorization()">Save Authorization</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Manage Environments Modal -->
    <div id="manageEnvironmentsModal" class="modal" onclick="closeManageEnvironmentsModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-title">⚙️ Manage Environments</div>
                <button class="close-btn" onclick="closeManageEnvironmentsModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px;">
                    <p style="font-size: 12px; opacity: 0.7; margin: 0;">Click on an environment to edit its variables.</p>
                </div>

                <div id="environments-list" style="display: flex; flex-direction: column; gap: 10px;">
                    <!-- Environment items will be populated here -->
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button class="send-button" onclick="showAddEnvironmentModal(); closeManageEnvironmentsModal();" style="padding: 8px 16px;">
                        + New Environment
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentTab = 'params';
        let collectionsData = [];
        let collectionAuthorizations = {}; // Store collection-level auth configs

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

        function addParam() {
            const grid = document.getElementById('params-grid');

            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.className = 'param-key';
            keyInput.placeholder = 'Key';

            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.className = 'param-value';
            valueInput.placeholder = 'Value';

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

        function changeAuthType() {
            const authType = document.getElementById('auth-type').value;
            const authFields = document.getElementById('auth-fields');
            authFields.innerHTML = '';

            switch(authType) {
                case 'bearer':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Token:</label>
                            <input type="text" id="auth-bearer-token" placeholder="Enter bearer token" style="width: 100%;">
                        </div>
                    \`;
                    break;
                case 'basic':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Username:</label>
                            <input type="text" id="auth-basic-username" placeholder="Username" style="width: 100%; max-width: 400px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Password:</label>
                            <input type="password" id="auth-basic-password" placeholder="Password" style="width: 100%; max-width: 400px;">
                        </div>
                    \`;
                    break;
                case 'apikey':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Key:</label>
                            <input type="text" id="auth-apikey-key" placeholder="API Key name" style="width: 100%; max-width: 400px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Value:</label>
                            <input type="text" id="auth-apikey-value" placeholder="API Key value" style="width: 100%; max-width: 400px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Add to:</label>
                            <select id="auth-apikey-location" style="width: 100%; max-width: 400px;">
                                <option value="header">Header</option>
                                <option value="query">Query Params</option>
                            </select>
                        </div>
                    \`;
                    break;
                case 'inherit':
                    // Check if current request is part of a collection
                    const currentTab = tabs.find(t => t.id === activeTabId);
                    const collectionId = currentTab?.collectionId;

                    if (collectionId) {
                        const collectionAuth = collectionAuthorizations[collectionId];
                        let inheritMessage = 'This request will inherit authorization from its parent collection.';

                        if (collectionAuth) {
                            switch(collectionAuth.type) {
                                case 'bearer':
                                    inheritMessage = \`<strong>Inheriting Bearer Token</strong><br>Token: \${collectionAuth.token ? '•'.repeat(Math.min(20, collectionAuth.token.length)) : 'Not set'}\`;
                                    break;
                                case 'basic':
                                    inheritMessage = \`<strong>Inheriting Basic Auth</strong><br>Username: \${collectionAuth.username || 'Not set'}<br>Password: \${'•'.repeat(8)}\`;
                                    break;
                                case 'apikey':
                                    inheritMessage = \`<strong>Inheriting API Key</strong><br>Key: \${collectionAuth.key || 'Not set'}<br>Location: \${collectionAuth.location || 'header'}\`;
                                    break;
                                case 'none':
                                    inheritMessage = '<strong>Collection has no authorization set.</strong>';
                                    break;
                            }
                        } else {
                            inheritMessage += '<br><br><em>Collection authorization not configured. Right-click the collection and select "Set Authorization".</em>';
                        }

                        authFields.innerHTML = \`
                            <div style="padding: 15px; background-color: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); border-radius: 4px;">
                                <p style="margin: 0; font-size: 13px;">\${inheritMessage}</p>
                            </div>
                        \`;
                    } else {
                        authFields.innerHTML = \`
                            <div style="padding: 15px; background-color: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); border-radius: 4px;">
                                <p style="margin: 0; font-size: 13px;">This request will inherit authorization from its parent collection.</p>
                                <p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.8;"><em>This request is not part of a collection.</em></p>
                            </div>
                        \`;
                    }
                    break;
            }
        }

        function getParams() {
            const grid = document.getElementById('params-grid');
            const keys = grid.querySelectorAll('.param-key');
            const values = grid.querySelectorAll('.param-value');
            const params = {};

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i].value.trim();
                const value = values[i].value.trim();
                if (key && value) {
                    params[key] = value;
                }
            }

            return params;
        }

        function getAuthorization() {
            const authType = document.getElementById('auth-type').value;

            switch(authType) {
                case 'bearer':
                    const token = document.getElementById('auth-bearer-token')?.value;
                    return token ? { type: 'bearer', token } : null;
                case 'basic':
                    const username = document.getElementById('auth-basic-username')?.value;
                    const password = document.getElementById('auth-basic-password')?.value;
                    return (username && password) ? { type: 'basic', username, password } : null;
                case 'apikey':
                    const key = document.getElementById('auth-apikey-key')?.value;
                    const value = document.getElementById('auth-apikey-value')?.value;
                    const location = document.getElementById('auth-apikey-location')?.value;
                    return (key && value) ? { type: 'apikey', key, value, location } : null;
                case 'none':
                    return { type: 'none' };
                case 'inherit':
                default:
                    return { type: 'inherit' };
            }
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

        function saveCurrentRequest() {
            const tab = tabs.find(t => t.id === activeTabId);
            if (!tab || !tab.collectionId) {
                alert('This request must be part of a collection. Right-click a collection and select "Add Request".');
                return;
            }

            const method = document.getElementById('method').value;
            const url = document.getElementById('url').value;
            const body = document.getElementById('body').value;
            const headers = getHeaders();
            const params = getParams();
            const authorization = getAuthorization();

            if (!url) {
                alert('Please enter a URL');
                return;
            }

            const request = {
                id: tab.requestId || 'req_' + Date.now(),
                name: method + ' ' + (url.split('?')[0].split('/').pop() || 'Request'),
                method,
                url,
                headers,
                params,
                authorization,
                body: body || undefined,
                timestamp: Date.now()
            };

            // Update tab
            tab.request = request;
            tab.requestId = request.id;
            tab.name = request.name;
            tab.method = request.method;

            vscode.postMessage({
                command: 'saveToCollection',
                request: request,
                collectionId: tab.collectionId
            });

            renderTabs();
        }

        function sendRequest() {
            const method = document.getElementById('method').value;
            let url = document.getElementById('url').value;
            const body = document.getElementById('body').value;
            const headers = getHeaders();
            const params = getParams();
            let authorization = getAuthorization();

            // Resolve inherited authorization
            if (authorization && authorization.type === 'inherit') {
                const currentTab = tabs.find(t => t.id === activeTabId);
                const collectionId = currentTab?.collectionId;
                if (collectionId && collectionAuthorizations[collectionId]) {
                    authorization = collectionAuthorizations[collectionId];
                } else {
                    authorization = { type: 'none' };
                }
            }

            // Add params to URL
            const paramString = Object.entries(params).map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(v)}\`).join('&');
            if (paramString) {
                url += (url.includes('?') ? '&' : '?') + paramString;
            }

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
                params,
                authorization,
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
            // Store for Manage Environments modal
            allEnvironmentsData = environments;

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
                    <div class="collection-header">
                        <span class="collection-icon" id="icon-\${col.id}" style="cursor: pointer; user-select: none;">▶</span>
                        <span style="cursor: pointer; flex: 1; display: flex; align-items: center; gap: 8px;">
                            <span>📁 \${col.name}</span>
                            <span style="opacity: 0.6; font-size: 11px; margin-left: auto;">(\${col.requestCount})</span>
                        </span>
                    </div>
                    <div class="collection-requests" id="requests-\${col.id}">
                        \${col.requests && col.requests.length > 0 ? col.requests.map(req => \`
                            <div class="request-item" data-collection-id="\${col.id}" data-request-id="\${req.id}">
                                <span class="request-method method-\${req.method}">\${req.method}</span>
                                <span>\${req.name || req.url}</span>
                            </div>
                        \`).join('') : '<div class="empty-state" style="padding: 20px 10px;">No requests</div>'}
                    </div>
                </div>
            \`).join('');

            // Add event listeners after rendering
            collections.forEach(col => {
                const icon = document.getElementById('icon-' + col.id);
                const header = icon?.parentElement;

                if (icon && header) {
                    // Arrow click - toggle expand/collapse
                    icon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleCollectionExpand(col.id);
                    });

                    // Collection name click - open details
                    const nameSpan = header.querySelector('span:nth-child(2)');
                    if (nameSpan) {
                        nameSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            openCollectionDetails(col.id);
                        });
                    }
                }

                // Request item clicks
                col.requests?.forEach(req => {
                    const requestItem = document.querySelector(\`[data-collection-id="\${col.id}"][data-request-id="\${req.id}"]\`);
                    if (requestItem) {
                        requestItem.addEventListener('click', () => {
                            loadCollectionRequestToTab(col.id, req.id);
                        });
                    }
                });
            });
        }

        function toggleCollectionExpand(collectionId) {
            const requestsDiv = document.getElementById('requests-' + collectionId);
            const icon = document.getElementById('icon-' + collectionId);

            if (requestsDiv && icon) {
                if (requestsDiv.classList.contains('show')) {
                    requestsDiv.classList.remove('show');
                    icon.classList.remove('expanded');
                } else {
                    requestsDiv.classList.add('show');
                    icon.classList.add('expanded');
                }
            }
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

        // Store original request builder HTML to restore later
        let originalRequestBuilderHTML = '';
        let isShowingCollectionDetails = false;

        function openCollectionDetails(collectionId) {
            const collection = collectionsData.find(c => c.id === collectionId);
            if (!collection) {
                console.error('Collection not found:', collectionId);
                return;
            }

            // Get existing authorization
            const existingAuth = collectionAuthorizations[collectionId] || { type: 'none' };

            // Save original HTML and show collection details
            const requestBuilder = document.querySelector('.request-builder');
            const responsePanel = document.querySelector('.response-panel');

            if (!requestBuilder) {
                console.error('Request builder not found');
                return;
            }

            // Save original HTML if not already saved
            if (!isShowingCollectionDetails) {
                originalRequestBuilderHTML = requestBuilder.innerHTML;
                isShowingCollectionDetails = true;
            }

            // Show response panel (it will hold our collection details)
            if (responsePanel) {
                responsePanel.style.display = 'flex';
            }

            requestBuilder.innerHTML = \`
                <div style="padding: 20px;">
                    <h2 style="margin: 0 0 20px 0; font-size: 20px; display: flex; align-items: center; gap: 10px;">
                        <span>📁</span>
                        <span>\${collection.name}</span>
                    </h2>

                    <div style="margin-bottom: 30px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px;">Collection Name</label>
                        <input type="text" id="collection-name-input" value="\${collection.name}"
                               style="width: 100%; max-width: 500px; padding: 8px 12px; background-color: var(--vscode-input-background);
                                      color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 30px;">
                        <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Authorization</h3>
                        <p style="font-size: 12px; opacity: 0.7; margin-bottom: 15px;">
                            Requests in this collection set to "Inherit from Collection" will use this authorization.
                        </p>

                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600;">Type:</label>
                            <select id="collection-detail-auth-type" onchange="changeCollectionDetailAuthType()"
                                    style="width: 100%; max-width: 300px; padding: 6px 10px; background-color: var(--vscode-input-background);
                                           color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                                <option value="none" \${existingAuth.type === 'none' ? 'selected' : ''}>No Auth</option>
                                <option value="bearer" \${existingAuth.type === 'bearer' ? 'selected' : ''}>Bearer Token</option>
                                <option value="basic" \${existingAuth.type === 'basic' ? 'selected' : ''}>Basic Auth</option>
                                <option value="apikey" \${existingAuth.type === 'apikey' ? 'selected' : ''}>API Key</option>
                            </select>
                        </div>

                        <div id="collection-detail-auth-fields"></div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-top: 30px;">
                        <button class="send-button" onclick="saveCollectionDetails('\${collectionId}')" style="padding: 10px 20px;">
                            💾 Save Changes
                        </button>
                        <button class="save-button" onclick="closeCollectionDetails()" style="padding: 10px 20px;">
                            ← Back to Requests
                        </button>
                    </div>
                </div>
            \`;

            // Trigger auth type change to populate fields
            changeCollectionDetailAuthType();

            // Populate existing auth values
            if (existingAuth.type !== 'none') {
                setTimeout(() => {
                    switch(existingAuth.type) {
                        case 'bearer':
                            const bearerInput = document.getElementById('collection-detail-auth-bearer-token');
                            if (bearerInput) bearerInput.value = existingAuth.token || '';
                            break;
                        case 'basic':
                            const usernameInput = document.getElementById('collection-detail-auth-basic-username');
                            const passwordInput = document.getElementById('collection-detail-auth-basic-password');
                            if (usernameInput) usernameInput.value = existingAuth.username || '';
                            if (passwordInput) passwordInput.value = existingAuth.password || '';
                            break;
                        case 'apikey':
                            const keyInput = document.getElementById('collection-detail-auth-apikey-key');
                            const valueInput = document.getElementById('collection-detail-auth-apikey-value');
                            const locationInput = document.getElementById('collection-detail-auth-apikey-location');
                            if (keyInput) keyInput.value = existingAuth.key || '';
                            if (valueInput) valueInput.value = existingAuth.value || '';
                            if (locationInput) locationInput.value = existingAuth.location || 'header';
                            break;
                    }
                }, 0);
            }
        }

        function changeCollectionDetailAuthType() {
            const authType = document.getElementById('collection-detail-auth-type').value;
            const authFields = document.getElementById('collection-detail-auth-fields');
            authFields.innerHTML = '';

            switch(authType) {
                case 'bearer':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Token:</label>
                            <input type="text" id="collection-detail-auth-bearer-token" placeholder="Enter bearer token"
                                   style="width: 100%; max-width: 500px; padding: 8px 12px; background-color: var(--vscode-input-background);
                                          color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        </div>
                    \`;
                    break;
                case 'basic':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Username:</label>
                            <input type="text" id="collection-detail-auth-basic-username" placeholder="Username"
                                   style="width: 100%; max-width: 400px; padding: 8px 12px; background-color: var(--vscode-input-background);
                                          color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Password:</label>
                            <input type="password" id="collection-detail-auth-basic-password" placeholder="Password"
                                   style="width: 100%; max-width: 400px; padding: 8px 12px; background-color: var(--vscode-input-background);
                                          color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        </div>
                    \`;
                    break;
                case 'apikey':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Key:</label>
                            <input type="text" id="collection-detail-auth-apikey-key" placeholder="API Key name"
                                   style="width: 100%; max-width: 400px; padding: 8px 12px; background-color: var(--vscode-input-background);
                                          color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Value:</label>
                            <input type="text" id="collection-detail-auth-apikey-value" placeholder="API Key value"
                                   style="width: 100%; max-width: 400px; padding: 8px 12px; background-color: var(--vscode-input-background);
                                          color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Add to:</label>
                            <select id="collection-detail-auth-apikey-location"
                                    style="width: 100%; max-width: 400px; padding: 6px 10px; background-color: var(--vscode-input-background);
                                           color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                                <option value="header">Header</option>
                                <option value="query">Query Params</option>
                            </select>
                        </div>
                    \`;
                    break;
                case 'none':
                    authFields.innerHTML = \`
                        <div style="padding: 15px; background-color: var(--vscode-textBlockQuote-background);
                                    border-left: 3px solid var(--vscode-focusBorder); border-radius: 4px;">
                            <p style="margin: 0; font-size: 13px;">Requests in this collection set to "Inherit" will have no authorization.</p>
                        </div>
                    \`;
                    break;
            }
        }

        function saveCollectionDetails(collectionId) {
            const collectionName = document.getElementById('collection-name-input').value.trim();
            const authType = document.getElementById('collection-detail-auth-type').value;

            let authorization;

            switch(authType) {
                case 'bearer':
                    const token = document.getElementById('collection-detail-auth-bearer-token')?.value;
                    authorization = token ? { type: 'bearer', token } : { type: 'none' };
                    break;
                case 'basic':
                    const username = document.getElementById('collection-detail-auth-basic-username')?.value;
                    const password = document.getElementById('collection-detail-auth-basic-password')?.value;
                    authorization = (username && password) ? { type: 'basic', username, password } : { type: 'none' };
                    break;
                case 'apikey':
                    const key = document.getElementById('collection-detail-auth-apikey-key')?.value;
                    const value = document.getElementById('collection-detail-auth-apikey-value')?.value;
                    const location = document.getElementById('collection-detail-auth-apikey-location')?.value;
                    authorization = (key && value) ? { type: 'apikey', key, value, location } : { type: 'none' };
                    break;
                case 'none':
                default:
                    authorization = { type: 'none' };
                    break;
            }

            // Store authorization locally
            collectionAuthorizations[collectionId] = authorization;

            // Send to backend
            vscode.postMessage({
                command: 'setCollectionAuthorization',
                collectionId: collectionId,
                authorization: authorization
            });

            // Show success and close
            alert('Collection settings saved!');
            closeCollectionDetails();
        }

        function closeCollectionDetails() {
            const requestBuilder = document.querySelector('.request-builder');
            const responsePanel = document.querySelector('.response-panel');

            if (requestBuilder && originalRequestBuilderHTML) {
                requestBuilder.innerHTML = originalRequestBuilderHTML;
                isShowingCollectionDetails = false;

                // Restore response panel
                if (responsePanel) {
                    responsePanel.style.display = 'flex';
                }

                // Re-initialize event listeners for the restored content
                initializeRequestBuilderEvents();
            }
        }

        function initializeRequestBuilderEvents() {
            // Re-attach any needed event listeners to the restored request builder
            // The main event listeners are inline in the HTML, so they should work automatically
        }

        function loadCollectionRequest(collectionId, requestId) {
            vscode.postMessage({
                command: 'loadCollectionRequest',
                collectionId: collectionId,
                requestId: requestId
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

        // Manage Environments Modal Functions
        let allEnvironmentsData = [];

        function showManageEnvironmentsModal() {
            const modal = document.getElementById('manageEnvironmentsModal');
            const listContainer = document.getElementById('environments-list');

            // Request fresh environment data
            vscode.postMessage({ command: 'loadEnvironments' });

            // Populate the list
            if (!allEnvironmentsData || allEnvironmentsData.length === 0) {
                listContainer.innerHTML = '<div class="empty-state">No environments yet. Create one to get started!</div>';
            } else {
                listContainer.innerHTML = allEnvironmentsData.map(env => \`
                    <div style="border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px; cursor: pointer; transition: background-color 0.2s;"
                         onmouseover="this.style.backgroundColor='var(--vscode-list-hoverBackground)'"
                         onmouseout="this.style.backgroundColor='transparent'"
                         onclick="editEnvironmentFromManage('\${env.id}', '\${env.name}')">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>\${env.name}</strong>
                                \${env.isActive ? '<span style="color: var(--vscode-focusBorder); margin-left: 8px;">✓ Active</span>' : ''}
                            </div>
                            <button class="env-edit-btn" onclick="event.stopPropagation(); editEnvironmentFromManage('\${env.id}', '\${env.name}')" title="Edit">
                                ✏️ Edit
                            </button>
                        </div>
                    </div>
                \`).join('');
            }

            modal.classList.add('show');
        }

        function closeManageEnvironmentsModal(event) {
            if (!event || event.target.id === 'manageEnvironmentsModal') {
                document.getElementById('manageEnvironmentsModal').classList.remove('show');
            }
        }

        function editEnvironmentFromManage(environmentId, environmentName) {
            // Close manage modal
            closeManageEnvironmentsModal();

            // Open edit modal
            currentEnvironmentId = environmentId;
            document.getElementById('edit-env-name').textContent = environmentName;

            // Request environment details from backend
            vscode.postMessage({
                command: 'getEnvironmentVariables',
                environmentId: environmentId
            });

            document.getElementById('editEnvironmentModal').classList.add('show');
        }

        // Collection Authorization Modal Functions
        function showCollectionAuthModal(collectionId) {
            currentCollectionAuthId = collectionId;
            const collection = collectionsData.find(c => c.id === collectionId);
            if (!collection) return;

            document.getElementById('collection-auth-name').textContent = collection.name;

            // Load existing auth if available
            const existingAuth = collectionAuthorizations[collectionId];
            if (existingAuth) {
                document.getElementById('collection-auth-type').value = existingAuth.type;
                changeCollectionAuthType();

                // Populate fields
                switch(existingAuth.type) {
                    case 'bearer':
                        document.getElementById('collection-auth-bearer-token').value = existingAuth.token || '';
                        break;
                    case 'basic':
                        document.getElementById('collection-auth-basic-username').value = existingAuth.username || '';
                        document.getElementById('collection-auth-basic-password').value = existingAuth.password || '';
                        break;
                    case 'apikey':
                        document.getElementById('collection-auth-apikey-key').value = existingAuth.key || '';
                        document.getElementById('collection-auth-apikey-value').value = existingAuth.value || '';
                        document.getElementById('collection-auth-apikey-location').value = existingAuth.location || 'header';
                        break;
                }
            } else {
                document.getElementById('collection-auth-type').value = 'none';
                changeCollectionAuthType();
            }

            document.getElementById('collectionAuthModal').classList.add('show');
        }

        function closeCollectionAuthModal(event) {
            if (!event || event.target.id === 'collectionAuthModal') {
                document.getElementById('collectionAuthModal').classList.remove('show');
                currentCollectionAuthId = null;
            }
        }

        function changeCollectionAuthType() {
            const authType = document.getElementById('collection-auth-type').value;
            const authFields = document.getElementById('collection-auth-fields');
            authFields.innerHTML = '';

            switch(authType) {
                case 'bearer':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Token:</label>
                            <input type="text" id="collection-auth-bearer-token" placeholder="Enter bearer token" style="width: 100%;">
                        </div>
                    \`;
                    break;
                case 'basic':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Username:</label>
                            <input type="text" id="collection-auth-basic-username" placeholder="Username" style="width: 100%; max-width: 400px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Password:</label>
                            <input type="password" id="collection-auth-basic-password" placeholder="Password" style="width: 100%; max-width: 400px;">
                        </div>
                    \`;
                    break;
                case 'apikey':
                    authFields.innerHTML = \`
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Key:</label>
                            <input type="text" id="collection-auth-apikey-key" placeholder="API Key name" style="width: 100%; max-width: 400px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Value:</label>
                            <input type="text" id="collection-auth-apikey-value" placeholder="API Key value" style="width: 100%; max-width: 400px;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Add to:</label>
                            <select id="collection-auth-apikey-location" style="width: 100%; max-width: 400px;">
                                <option value="header">Header</option>
                                <option value="query">Query Params</option>
                            </select>
                        </div>
                    \`;
                    break;
                case 'none':
                    authFields.innerHTML = \`
                        <div style="padding: 15px; background-color: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); border-radius: 4px;">
                            <p style="margin: 0; font-size: 13px;">Requests in this collection set to "Inherit" will have no authorization.</p>
                        </div>
                    \`;
                    break;
            }
        }

        function saveCollectionAuthorization() {
            if (!currentCollectionAuthId) return;

            const authType = document.getElementById('collection-auth-type').value;
            let authorization;

            switch(authType) {
                case 'bearer':
                    const token = document.getElementById('collection-auth-bearer-token')?.value;
                    authorization = token ? { type: 'bearer', token } : { type: 'none' };
                    break;
                case 'basic':
                    const username = document.getElementById('collection-auth-basic-username')?.value;
                    const password = document.getElementById('collection-auth-basic-password')?.value;
                    authorization = (username && password) ? { type: 'basic', username, password } : { type: 'none' };
                    break;
                case 'apikey':
                    const key = document.getElementById('collection-auth-apikey-key')?.value;
                    const value = document.getElementById('collection-auth-apikey-value')?.value;
                    const location = document.getElementById('collection-auth-apikey-location')?.value;
                    authorization = (key && value) ? { type: 'apikey', key, value, location } : { type: 'none' };
                    break;
                case 'none':
                default:
                    authorization = { type: 'none' };
                    break;
            }

            // Store locally
            collectionAuthorizations[currentCollectionAuthId] = authorization;

            // Send to backend
            vscode.postMessage({
                command: 'setCollectionAuthorization',
                collectionId: currentCollectionAuthId,
                authorization: authorization
            });

            closeCollectionAuthModal();
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
        let currentCollectionAuthId = null;

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
                case 'setAuthorization':
                    showCollectionAuthModal(contextMenuTarget);
                    break;
                case 'addRequest':
                    // Create new tab and associate with collection
                    const tabId = 'tab_' + Date.now();
                    const requestId = 'req_' + Date.now();

                    // Create a draft request that shows immediately in the collection
                    const draftRequest = {
                        id: requestId,
                        name: 'New Request',
                        method: 'GET',
                        url: '',
                        headers: {},
                        params: {},
                        authorization: { type: 'inherit' },
                        body: undefined,
                        timestamp: Date.now(),
                        isDraft: true
                    };

                    tabs.push({
                        id: tabId,
                        method: 'GET',
                        name: 'New Request',
                        request: draftRequest,
                        requestId: requestId,
                        collectionId: contextMenuTarget
                    });

                    // Add draft request to collection immediately
                    vscode.postMessage({
                        command: 'addDraftToCollection',
                        request: draftRequest,
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
