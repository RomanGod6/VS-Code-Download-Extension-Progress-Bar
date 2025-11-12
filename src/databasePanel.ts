import * as vscode from 'vscode';
import { DatabaseManager, ConnectionConfig, DatabaseType } from './databaseManager';

export class DatabasePanel {
    public static currentPanel: DatabasePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private currentConnectionId: string | undefined;

    public static createOrShow(context: vscode.ExtensionContext, databaseManager: DatabaseManager) {
        const column = vscode.ViewColumn.One;

        if (DatabasePanel.currentPanel) {
            DatabasePanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'databaseManager',
            '🗄️ Database Manager',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(context.extensionPath)]
            }
        );

        DatabasePanel.currentPanel = new DatabasePanel(panel, context, databaseManager);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private databaseManager: DatabaseManager
    ) {
        this._panel = panel;
        this._panel.webview.html = this._getHtmlContent();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'connect':
                        await this.handleConnect(message.config);
                        break;
                    case 'disconnect':
                        await this.handleDisconnect(message.connectionId);
                        break;
                    case 'getTables':
                        await this.handleGetTables(message.connectionId);
                        break;
                    case 'getTableColumns':
                        await this.handleGetTableColumns(message.connectionId, message.tableName, message.schema);
                        break;
                    case 'executeQuery':
                        await this.handleExecuteQuery(message.connectionId, message.query);
                        break;
                    case 'getTableData':
                        await this.handleGetTableData(message.connectionId, message.tableName, message.limit, message.offset);
                        break;
                    case 'saveConnection':
                        await this.handleSaveConnection(message.config);
                        break;
                    case 'loadConnections':
                        await this.handleLoadConnections();
                        break;
                    case 'deleteConnection':
                        await this.handleDeleteConnection(message.connectionId);
                        break;
                    case 'saveQuery':
                        await this.handleSaveQuery(message.query, message.name);
                        break;
                    case 'loadQueries':
                        await this.handleLoadQueries();
                        break;
                    case 'deleteQuery':
                        await this.handleDeleteQuery(message.queryId);
                        break;
                    case 'exportData':
                        await this.handleExportData(message.format, message.data);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async handleConnect(config: ConnectionConfig) {
        try {
            const success = await this.databaseManager.connect(config);
            if (success) {
                this.currentConnectionId = config.id;
                this._panel.webview.postMessage({
                    command: 'connectionSuccess',
                    connectionId: config.id
                });
                vscode.window.showInformationMessage(`Connected to ${config.name}`);
            } else {
                this._panel.webview.postMessage({
                    command: 'connectionError',
                    error: 'Failed to connect'
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'connectionError',
                error: errorMessage
            });
            vscode.window.showErrorMessage(`Connection failed: ${errorMessage}`);
        }
    }

    private async handleDisconnect(connectionId: string) {
        try {
            await this.databaseManager.disconnect(connectionId);
            if (this.currentConnectionId === connectionId) {
                this.currentConnectionId = undefined;
            }
            this._panel.webview.postMessage({
                command: 'disconnected',
                connectionId
            });
            vscode.window.showInformationMessage('Disconnected from database');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Disconnect failed: ${errorMessage}`);
        }
    }

    private async handleGetTables(connectionId: string) {
        try {
            const tables = await this.databaseManager.getTables(connectionId);
            this._panel.webview.postMessage({
                command: 'tablesLoaded',
                tables
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load tables: ${errorMessage}`);
        }
    }

    private async handleGetTableColumns(connectionId: string, tableName: string, schema?: string) {
        try {
            const columns = await this.databaseManager.getTableColumns(connectionId, tableName, schema);
            this._panel.webview.postMessage({
                command: 'columnsLoaded',
                tableName,
                columns
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load columns: ${errorMessage}`);
        }
    }

    private async handleExecuteQuery(connectionId: string, query: string) {
        try {
            const result = await this.databaseManager.executeQuery(connectionId, query);
            this._panel.webview.postMessage({
                command: 'queryResult',
                result
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'queryError',
                error: errorMessage
            });
        }
    }

    private async handleGetTableData(connectionId: string, tableName: string, limit: number, offset: number) {
        try {
            const result = await this.databaseManager.getTableData(connectionId, tableName, limit, offset);
            this._panel.webview.postMessage({
                command: 'tableDataLoaded',
                tableName,
                result
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load table data: ${errorMessage}`);
        }
    }

    private async handleSaveConnection(config: ConnectionConfig) {
        try {
            const connections = this.context.globalState.get<ConnectionConfig[]>('savedConnections', []);
            const existingIndex = connections.findIndex(c => c.id === config.id);

            if (existingIndex >= 0) {
                connections[existingIndex] = config;
            } else {
                connections.push(config);
            }

            await this.context.globalState.update('savedConnections', connections);
            this._panel.webview.postMessage({
                command: 'connectionSaved',
                config
            });
            vscode.window.showInformationMessage('Connection saved successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to save connection: ${errorMessage}`);
        }
    }

    private async handleLoadConnections() {
        try {
            const connections = this.context.globalState.get<ConnectionConfig[]>('savedConnections', []);
            this._panel.webview.postMessage({
                command: 'connectionsLoaded',
                connections
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load connections: ${errorMessage}`);
        }
    }

    private async handleDeleteConnection(connectionId: string) {
        try {
            const connections = this.context.globalState.get<ConnectionConfig[]>('savedConnections', []);
            const filtered = connections.filter(c => c.id !== connectionId);
            await this.context.globalState.update('savedConnections', filtered);
            this._panel.webview.postMessage({
                command: 'connectionDeleted',
                connectionId
            });
            vscode.window.showInformationMessage('Connection deleted');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to delete connection: ${errorMessage}`);
        }
    }

    private async handleSaveQuery(query: string, name: string) {
        try {
            const queries = this.context.globalState.get<any[]>('savedQueries', []);
            queries.push({
                id: Date.now().toString(),
                name,
                query,
                timestamp: new Date().toISOString()
            });
            await this.context.globalState.update('savedQueries', queries);
            this._panel.webview.postMessage({
                command: 'querySaved'
            });
            vscode.window.showInformationMessage('Query saved successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to save query: ${errorMessage}`);
        }
    }

    private async handleLoadQueries() {
        try {
            const queries = this.context.globalState.get<any[]>('savedQueries', []);
            this._panel.webview.postMessage({
                command: 'queriesLoaded',
                queries
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load queries: ${errorMessage}`);
        }
    }

    private async handleDeleteQuery(queryId: string) {
        try {
            const queries = this.context.globalState.get<any[]>('savedQueries', []);
            const filtered = queries.filter(q => q.id !== queryId);
            await this.context.globalState.update('savedQueries', filtered);
            this._panel.webview.postMessage({
                command: 'queryDeleted',
                queryId
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to delete query: ${errorMessage}`);
        }
    }

    private async handleExportData(format: string, data: any) {
        try {
            let content = '';
            let extension = '';

            if (format === 'csv') {
                content = this.convertToCSV(data);
                extension = 'csv';
            } else if (format === 'json') {
                content = JSON.stringify(data, null, 2);
                extension = 'json';
            } else if (format === 'sql') {
                content = this.convertToSQL(data);
                extension = 'sql';
            }

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`export.${extension}`),
                filters: {
                    [format.toUpperCase()]: [extension]
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                vscode.window.showInformationMessage(`Data exported to ${uri.fsPath}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Export failed: ${errorMessage}`);
        }
    }

    private convertToCSV(data: any): string {
        if (!data.rows || data.rows.length === 0) return '';

        const headers = data.columns.join(',');
        const rows = data.rows.map((row: any) =>
            data.columns.map((col: string) => {
                const value = row[col];
                if (value === null || value === undefined) return '';
                const str = String(value);
                return str.includes(',') ? `"${str}"` : str;
            }).join(',')
        );

        return [headers, ...rows].join('\n');
    }

    private convertToSQL(data: any): string {
        if (!data.rows || data.rows.length === 0) return '';

        const tableName = 'exported_data';
        const rows = data.rows.map((row: any) => {
            const values = data.columns.map((col: string) => {
                const value = row[col];
                if (value === null || value === undefined) return 'NULL';
                if (typeof value === 'number') return value;
                return `'${String(value).replace(/'/g, "''")}'`;
            }).join(', ');
            return `INSERT INTO ${tableName} (${data.columns.join(', ')}) VALUES (${values});`;
        });

        return rows.join('\n');
    }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Database Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            height: 100vh;
            overflow: hidden;
        }

        .container {
            display: flex;
            height: 100vh;
        }

        /* Sidebar */
        .sidebar {
            width: 250px;
            background: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .sidebar-header {
            padding: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .sidebar-header h3 {
            font-size: 14px;
            font-weight: 600;
        }

        .btn-icon {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 5px 8px;
            border-radius: 4px;
            font-size: 16px;
        }

        .btn-icon:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .sidebar-content {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }

        .connection-item {
            padding: 10px;
            margin-bottom: 5px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border: 1px solid transparent;
        }

        .connection-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-panel-border);
        }

        .connection-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .connection-info {
            flex: 1;
        }

        .connection-name {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 3px;
        }

        .connection-type {
            font-size: 11px;
            opacity: 0.8;
        }

        .connection-actions {
            display: flex;
            gap: 5px;
        }

        .btn-small {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 3px 6px;
            border-radius: 3px;
            font-size: 12px;
        }

        .btn-small:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        /* Main Area */
        .main-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .toolbar {
            padding: 10px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 10px;
            align-items: center;
            background: var(--vscode-editor-background);
        }

        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .content-area {
            flex: 1;
            display: flex;
            overflow: hidden;
        }

        /* Schema Explorer */
        .schema-panel {
            width: 250px;
            background: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            overflow-y: auto;
            padding: 10px;
        }

        .schema-tree {
            list-style: none;
        }

        .tree-item {
            padding: 6px 8px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .tree-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tree-item.expanded {
            font-weight: 600;
        }

        .tree-children {
            margin-left: 20px;
            list-style: none;
        }

        .tree-icon {
            font-size: 12px;
            width: 16px;
        }

        /* Query Editor & Results */
        .editor-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .editor-header {
            padding: 10px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--vscode-editor-background);
        }

        .editor-tabs {
            display: flex;
            gap: 5px;
        }

        .editor-tab {
            padding: 6px 12px;
            background: var(--vscode-tab-inactiveBackground);
            border: none;
            border-radius: 4px 4px 0 0;
            cursor: pointer;
            font-size: 12px;
        }

        .editor-tab.active {
            background: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
        }

        .query-editor {
            height: 300px;
            padding: 15px;
            background: var(--vscode-editor-background);
            overflow: auto;
        }

        textarea {
            width: 100%;
            height: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            resize: none;
        }

        .results-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: var(--vscode-editor-background);
        }

        .results-header {
            padding: 10px 15px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--vscode-editor-background);
        }

        .results-info {
            font-size: 12px;
            opacity: 0.8;
        }

        .results-actions {
            display: flex;
            gap: 5px;
        }

        .results-table-wrapper {
            flex: 1;
            overflow: auto;
            padding: 15px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }

        th {
            background: var(--vscode-editor-background);
            padding: 10px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            z-index: 1;
        }

        td {
            padding: 8px 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        tr:hover {
            background: var(--vscode-list-hoverBackground);
        }

        /* Query History Panel */
        .history-panel {
            width: 250px;
            background: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            overflow-y: auto;
            padding: 10px;
        }

        .history-header {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 10px;
            padding: 5px 0;
        }

        .history-item {
            padding: 10px;
            margin-bottom: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }

        .history-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .history-item-name {
            font-weight: 600;
            margin-bottom: 5px;
        }

        .history-item-query {
            opacity: 0.8;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 5px;
        }

        .history-item-time {
            font-size: 10px;
            opacity: 0.6;
        }

        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .modal.show {
            display: flex;
        }

        .modal-content {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        }

        .modal-header {
            padding: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modal-header h2 {
            font-size: 16px;
            font-weight: 600;
        }

        .modal-body {
            padding: 20px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-size: 13px;
            font-weight: 500;
        }

        .form-group input,
        .form-group select {
            width: 100%;
            padding: 8px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
        }

        .form-group input:focus,
        .form-group select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .form-row {
            display: flex;
            gap: 10px;
        }

        .form-row .form-group {
            flex: 1;
        }

        .modal-footer {
            padding: 15px 20px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }

        .status-bar {
            padding: 5px 15px;
            background: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            font-size: 11px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
        }

        .status-item {
            display: flex;
            gap: 15px;
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            opacity: 0.6;
            text-align: center;
            padding: 40px;
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 15px;
        }

        .empty-state-text {
            font-size: 14px;
            margin-bottom: 20px;
        }

        .error-message {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 10px 15px;
            border-radius: 4px;
            margin-bottom: 15px;
            font-size: 12px;
        }

        .success-message {
            background: var(--vscode-testing-iconPassed);
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            margin-bottom: 15px;
            font-size: 12px;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 5px;
        }

        .checkbox-group input[type="checkbox"] {
            width: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Connections Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h3>🔌 Connections</h3>
                <button class="btn-icon" onclick="showNewConnectionModal()" title="New Connection">➕</button>
            </div>
            <div class="sidebar-content" id="connections-list">
                <div class="empty-state">
                    <div class="empty-state-icon">🔌</div>
                    <div class="empty-state-text">No saved connections.<br>Click ➕ to add one.</div>
                </div>
            </div>
        </div>

        <!-- Main Area -->
        <div class="main-area">
            <div class="toolbar">
                <button class="btn" onclick="executeQuery()" title="Run Query (Ctrl+Enter)">▶ Run Query</button>
                <button class="btn btn-secondary" onclick="clearQuery()">🗑️ Clear</button>
                <button class="btn btn-secondary" onclick="showSaveQueryModal()">💾 Save Query</button>
                <div style="flex: 1;"></div>
                <button class="btn btn-secondary" onclick="refreshSchema()">🔄 Refresh</button>
            </div>

            <div class="content-area">
                <!-- Schema Explorer -->
                <div class="schema-panel">
                    <div class="schema-header" style="padding: 10px 0; font-weight: 600; font-size: 13px; margin-bottom: 10px;">
                        📊 Schema
                    </div>
                    <div id="schema-tree">
                        <div class="empty-state">
                            <div class="empty-state-icon">📊</div>
                            <div class="empty-state-text">Connect to a database to view schema</div>
                        </div>
                    </div>
                </div>

                <!-- Editor & Results -->
                <div class="editor-panel">
                    <div class="query-editor">
                        <textarea id="query-input" placeholder="-- Write your SQL query here&#10;SELECT * FROM table_name LIMIT 10;"></textarea>
                    </div>

                    <div class="results-panel">
                        <div class="results-header">
                            <div class="results-info" id="results-info">No query executed</div>
                            <div class="results-actions">
                                <button class="btn-small" onclick="exportData('csv')" title="Export as CSV">📄 CSV</button>
                                <button class="btn-small" onclick="exportData('json')" title="Export as JSON">📄 JSON</button>
                                <button class="btn-small" onclick="exportData('sql')" title="Export as SQL">📄 SQL</button>
                            </div>
                        </div>
                        <div class="results-table-wrapper" id="results-container">
                            <div class="empty-state">
                                <div class="empty-state-icon">📊</div>
                                <div class="empty-state-text">Execute a query to see results</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Query History -->
                <div class="history-panel">
                    <div class="history-header">📜 Saved Queries</div>
                    <div id="history-list">
                        <div class="empty-state">
                            <div class="empty-state-text">No saved queries</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="status-bar">
        <div class="status-item">
            <span id="status-connection">Not connected</span>
        </div>
        <div class="status-item">
            <span id="status-info"></span>
        </div>
    </div>

    <!-- New Connection Modal -->
    <div class="modal" id="connectionModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>New Database Connection</h2>
                <button class="btn-icon" onclick="closeModal('connectionModal')">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Connection Name</label>
                    <input type="text" id="conn-name" placeholder="My Database" />
                </div>

                <div class="form-group">
                    <label>Database Type</label>
                    <select id="conn-type" onchange="updateConnectionForm()">
                        <option value="sqlite">SQLite</option>
                        <option value="postgresql">PostgreSQL</option>
                        <option value="mysql">MySQL</option>
                        <option value="mariadb">MariaDB</option>
                    </select>
                </div>

                <div id="sqlite-fields">
                    <div class="form-group">
                        <label>Database File Path</label>
                        <input type="text" id="conn-filepath" placeholder="/path/to/database.db" />
                    </div>
                </div>

                <div id="server-fields" style="display: none;">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Host</label>
                            <input type="text" id="conn-host" placeholder="localhost" />
                        </div>
                        <div class="form-group">
                            <label>Port</label>
                            <input type="number" id="conn-port" placeholder="5432" />
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Database</label>
                        <input type="text" id="conn-database" placeholder="my_database" />
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Username</label>
                            <input type="text" id="conn-username" placeholder="postgres" />
                        </div>
                        <div class="form-group">
                            <label>Password</label>
                            <input type="password" id="conn-password" placeholder="password" />
                        </div>
                    </div>

                    <div class="form-group">
                        <div class="checkbox-group">
                            <input type="checkbox" id="conn-ssl" />
                            <label for="conn-ssl" style="margin: 0;">Use SSL</label>
                        </div>
                    </div>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="conn-save" checked />
                    <label for="conn-save" style="margin: 0;">Save connection</label>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('connectionModal')">Cancel</button>
                <button class="btn" onclick="testConnection()">🔌 Test Connection</button>
                <button class="btn" onclick="connectToDatabase()">Connect</button>
            </div>
        </div>
    </div>

    <!-- Save Query Modal -->
    <div class="modal" id="saveQueryModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Save Query</h2>
                <button class="btn-icon" onclick="closeModal('saveQueryModal')">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Query Name</label>
                    <input type="text" id="query-name" placeholder="My Query" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('saveQueryModal')">Cancel</button>
                <button class="btn" onclick="saveQuery()">Save</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConnectionId = null;
        let currentQueryResult = null;
        let savedConnections = [];
        let savedQueries = [];

        // Initialize
        window.addEventListener('load', () => {
            loadConnections();
            loadQueries();

            // Keyboard shortcuts
            document.getElementById('query-input').addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    executeQuery();
                }
            });
        });

        // Message handling
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'connectionSuccess':
                    currentConnectionId = message.connectionId;
                    updateStatusBar('Connected');
                    loadTables();
                    closeModal('connectionModal');
                    break;

                case 'connectionError':
                    alert('Connection failed: ' + message.error);
                    break;

                case 'disconnected':
                    if (currentConnectionId === message.connectionId) {
                        currentConnectionId = null;
                        updateStatusBar('Not connected');
                        clearSchema();
                    }
                    break;

                case 'tablesLoaded':
                    renderSchema(message.tables);
                    break;

                case 'columnsLoaded':
                    console.log('Columns for ' + message.tableName, message.columns);
                    break;

                case 'queryResult':
                    currentQueryResult = message.result;
                    renderQueryResult(message.result);
                    break;

                case 'queryError':
                    renderQueryError(message.error);
                    break;

                case 'tableDataLoaded':
                    currentQueryResult = message.result;
                    renderQueryResult(message.result);
                    break;

                case 'connectionsLoaded':
                    savedConnections = message.connections;
                    renderConnections();
                    break;

                case 'connectionSaved':
                    loadConnections();
                    break;

                case 'connectionDeleted':
                    loadConnections();
                    break;

                case 'queriesLoaded':
                    savedQueries = message.queries;
                    renderQueries();
                    break;

                case 'querySaved':
                    loadQueries();
                    closeModal('saveQueryModal');
                    break;

                case 'queryDeleted':
                    loadQueries();
                    break;
            }
        });

        // Connection Management
        function showNewConnectionModal() {
            document.getElementById('connectionModal').classList.add('show');
            updateConnectionForm();
        }

        function updateConnectionForm() {
            const type = document.getElementById('conn-type').value;
            const sqliteFields = document.getElementById('sqlite-fields');
            const serverFields = document.getElementById('server-fields');

            if (type === 'sqlite') {
                sqliteFields.style.display = 'block';
                serverFields.style.display = 'none';
            } else {
                sqliteFields.style.display = 'none';
                serverFields.style.display = 'block';

                // Set default ports
                const portInput = document.getElementById('conn-port');
                if (type === 'postgresql') {
                    portInput.value = '5432';
                } else if (type === 'mysql' || type === 'mariadb') {
                    portInput.value = '3306';
                }
            }
        }

        function connectToDatabase() {
            const config = getConnectionConfig();

            if (!config.name) {
                alert('Please enter a connection name');
                return;
            }

            vscode.postMessage({
                command: 'connect',
                config: config
            });

            if (document.getElementById('conn-save').checked) {
                vscode.postMessage({
                    command: 'saveConnection',
                    config: config
                });
            }
        }

        function testConnection() {
            const config = getConnectionConfig();
            vscode.postMessage({
                command: 'connect',
                config: config
            });
        }

        function getConnectionConfig() {
            const type = document.getElementById('conn-type').value;
            const config = {
                id: Date.now().toString(),
                name: document.getElementById('conn-name').value,
                type: type
            };

            if (type === 'sqlite') {
                config.filePath = document.getElementById('conn-filepath').value;
            } else {
                config.host = document.getElementById('conn-host').value;
                config.port = parseInt(document.getElementById('conn-port').value);
                config.database = document.getElementById('conn-database').value;
                config.username = document.getElementById('conn-username').value;
                config.password = document.getElementById('conn-password').value;
                config.ssl = document.getElementById('conn-ssl').checked;
            }

            return config;
        }

        function connectToSaved(connectionId) {
            const connection = savedConnections.find(c => c.id === connectionId);
            if (connection) {
                vscode.postMessage({
                    command: 'connect',
                    config: connection
                });
            }
        }

        function disconnectCurrent() {
            if (currentConnectionId) {
                vscode.postMessage({
                    command: 'disconnect',
                    connectionId: currentConnectionId
                });
            }
        }

        function deleteConnection(connectionId, event) {
            event.stopPropagation();
            if (confirm('Delete this connection?')) {
                vscode.postMessage({
                    command: 'deleteConnection',
                    connectionId: connectionId
                });
            }
        }

        function loadConnections() {
            vscode.postMessage({ command: 'loadConnections' });
        }

        function renderConnections() {
            const container = document.getElementById('connections-list');

            if (savedConnections.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">🔌</div>
                        <div class="empty-state-text">No saved connections.<br>Click ➕ to add one.</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = savedConnections.map(conn => \`
                <div class="connection-item \${conn.id === currentConnectionId ? 'active' : ''}"
                     onclick="connectToSaved('\${conn.id}')">
                    <div class="connection-info">
                        <div class="connection-name">\${conn.name}</div>
                        <div class="connection-type">\${conn.type.toUpperCase()}\${conn.host ? ' • ' + conn.host : ''}</div>
                    </div>
                    <div class="connection-actions">
                        <button class="btn-small" onclick="deleteConnection('\${conn.id}', event)" title="Delete">🗑️</button>
                    </div>
                </div>
            \`).join('');
        }

        // Schema Management
        function loadTables() {
            if (!currentConnectionId) return;
            vscode.postMessage({
                command: 'getTables',
                connectionId: currentConnectionId
            });
        }

        function refreshSchema() {
            loadTables();
        }

        function renderSchema(tables) {
            const container = document.getElementById('schema-tree');

            if (!tables || tables.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📊</div>
                        <div class="empty-state-text">No tables found</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = \`
                <ul class="schema-tree">
                    \${tables.map(table => \`
                        <li class="tree-item" onclick="viewTableData('\${table.name}', '\${table.schema || ''}')">
                            <span class="tree-icon">\${table.type === 'table' ? '📋' : '👁️'}</span>
                            <span>\${table.name}</span>
                        </li>
                    \`).join('')}
                </ul>
            \`;
        }

        function clearSchema() {
            document.getElementById('schema-tree').innerHTML = \`
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <div class="empty-state-text">Connect to a database to view schema</div>
                </div>
            \`;
        }

        function viewTableData(tableName, schema) {
            if (!currentConnectionId) return;

            vscode.postMessage({
                command: 'getTableData',
                connectionId: currentConnectionId,
                tableName: tableName,
                limit: 100,
                offset: 0
            });

            // Also update query editor
            document.getElementById('query-input').value = \`SELECT * FROM "\${tableName}" LIMIT 100;\`;
        }

        // Query Execution
        function executeQuery() {
            if (!currentConnectionId) {
                alert('Please connect to a database first');
                return;
            }

            const query = document.getElementById('query-input').value.trim();
            if (!query) {
                alert('Please enter a query');
                return;
            }

            vscode.postMessage({
                command: 'executeQuery',
                connectionId: currentConnectionId,
                query: query
            });
        }

        function clearQuery() {
            document.getElementById('query-input').value = '';
        }

        function renderQueryResult(result) {
            const container = document.getElementById('results-container');
            const info = document.getElementById('results-info');

            info.textContent = \`\${result.rowCount} row(s) returned in \${result.executionTime}ms\`;

            if (!result.rows || result.rows.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">✅</div>
                        <div class="empty-state-text">Query executed successfully<br>No rows returned</div>
                    </div>
                \`;
                return;
            }

            const tableHtml = \`
                <table>
                    <thead>
                        <tr>
                            \${result.columns.map(col => \`<th>\${col}</th>\`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        \${result.rows.map(row => \`
                            <tr>
                                \${result.columns.map(col => \`
                                    <td>\${row[col] !== null && row[col] !== undefined ? row[col] : '<em>NULL</em>'}</td>
                                \`).join('')}
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;

            container.innerHTML = tableHtml;
        }

        function renderQueryError(error) {
            const container = document.getElementById('results-container');
            const info = document.getElementById('results-info');

            info.textContent = 'Query failed';
            container.innerHTML = \`
                <div class="error-message">
                    <strong>Error:</strong> \${error}
                </div>
            \`;
        }

        // Query History
        function showSaveQueryModal() {
            const query = document.getElementById('query-input').value.trim();
            if (!query) {
                alert('Please enter a query first');
                return;
            }
            document.getElementById('saveQueryModal').classList.add('show');
        }

        function saveQuery() {
            const query = document.getElementById('query-input').value.trim();
            const name = document.getElementById('query-name').value.trim();

            if (!name || !query) {
                alert('Please enter both name and query');
                return;
            }

            vscode.postMessage({
                command: 'saveQuery',
                query: query,
                name: name
            });

            document.getElementById('query-name').value = '';
        }

        function loadQueries() {
            vscode.postMessage({ command: 'loadQueries' });
        }

        function renderQueries() {
            const container = document.getElementById('history-list');

            if (savedQueries.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-text">No saved queries</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = savedQueries.map(query => \`
                <div class="history-item" onclick="loadQueryToEditor('\${query.id}')">
                    <div class="history-item-name">\${query.name}</div>
                    <div class="history-item-query">\${query.query}</div>
                    <div class="history-item-time">\${new Date(query.timestamp).toLocaleString()}</div>
                    <button class="btn-small" onclick="deleteQuery('\${query.id}', event)" style="margin-top: 5px;">🗑️ Delete</button>
                </div>
            \`).join('');
        }

        function loadQueryToEditor(queryId) {
            const query = savedQueries.find(q => q.id === queryId);
            if (query) {
                document.getElementById('query-input').value = query.query;
            }
        }

        function deleteQuery(queryId, event) {
            event.stopPropagation();
            if (confirm('Delete this query?')) {
                vscode.postMessage({
                    command: 'deleteQuery',
                    queryId: queryId
                });
            }
        }

        // Export
        function exportData(format) {
            if (!currentQueryResult || !currentQueryResult.rows || currentQueryResult.rows.length === 0) {
                alert('No data to export');
                return;
            }

            vscode.postMessage({
                command: 'exportData',
                format: format,
                data: currentQueryResult
            });
        }

        // UI Helpers
        function closeModal(modalId) {
            document.getElementById(modalId).classList.remove('show');
        }

        function updateStatusBar(status) {
            document.getElementById('status-connection').textContent = status;
        }

        // Close modals on outside click
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.classList.remove('show');
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        DatabasePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
