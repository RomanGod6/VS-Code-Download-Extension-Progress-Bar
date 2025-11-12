import * as vscode from 'vscode';
import { SQLiteManager, QueryResult } from './sqliteManager';

export class SQLitePanel {
    public static currentPanel: SQLitePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private sqliteManager: SQLiteManager,
        private outputChannel: vscode.OutputChannel
    ) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getHtmlContent();

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'openDatabase':
                        await this.handleOpenDatabase();
                        break;
                    case 'createDatabase':
                        await this.handleCreateDatabase();
                        break;
                    case 'closeDatabase':
                        this.handleCloseDatabase();
                        break;
                    case 'getTables':
                        this.sendTables();
                        break;
                    case 'getTableColumns':
                        this.sendTableColumns(message.tableName);
                        break;
                    case 'getTableData':
                        await this.handleGetTableData(message.tableName, message.limit, message.offset);
                        break;
                    case 'executeQuery':
                        await this.handleExecuteQuery(message.query);
                        break;
                }
            },
            null,
            this._disposables
        );

        // Send initial state
        this.sendConnectionStatus();
    }

    public static createOrShow(sqliteManager: SQLiteManager, outputChannel: vscode.OutputChannel) {
        const column = vscode.ViewColumn.One;

        if (SQLitePanel.currentPanel) {
            SQLitePanel.currentPanel._panel.reveal(column);
            SQLitePanel.currentPanel.sendConnectionStatus();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'sqliteManager',
            '🗄️ SQLite Manager',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        SQLitePanel.currentPanel = new SQLitePanel(panel, sqliteManager, outputChannel);
    }

    private async handleOpenDatabase() {
        const success = await this.sqliteManager.openDatabase();
        if (success) {
            this.sendConnectionStatus();
            this.sendTables();
        }
    }

    private async handleCreateDatabase() {
        const success = await this.sqliteManager.createDatabase();
        if (success) {
            this.sendConnectionStatus();
            this.sendTables();
        }
    }

    private handleCloseDatabase() {
        this.sqliteManager.closeDatabase();
        this.sendConnectionStatus();
    }

    private sendConnectionStatus() {
        const isConnected = this.sqliteManager.isConnected();
        const dbName = this.sqliteManager.getCurrentDatabaseName();

        this._panel.webview.postMessage({
            command: 'connectionStatus',
            isConnected,
            databaseName: dbName
        });
    }

    private sendTables() {
        try {
            const tables = this.sqliteManager.getTables();
            this._panel.webview.postMessage({
                command: 'updateTables',
                tables
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    private sendTableColumns(tableName: string) {
        try {
            const columns = this.sqliteManager.getTableColumns(tableName);
            const rowCount = this.sqliteManager.getRowCount(tableName);

            this._panel.webview.postMessage({
                command: 'updateTableColumns',
                tableName,
                columns,
                rowCount
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    private async handleGetTableData(tableName: string, limit: number = 100, offset: number = 0) {
        try {
            const result = this.sqliteManager.getTableData(tableName, limit, offset);
            this._panel.webview.postMessage({
                command: 'queryResult',
                result,
                tableName
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    private async handleExecuteQuery(query: string) {
        this.outputChannel.appendLine(`\n🔍 Executing query: ${query}`);

        this._panel.webview.postMessage({
            command: 'queryStarted'
        });

        try {
            const result = this.sqliteManager.executeQuery(query);

            this.outputChannel.appendLine(`✅ Query executed in ${result.executionTime}ms`);
            this.outputChannel.appendLine(`   Rows affected/returned: ${result.rowCount}`);

            this._panel.webview.postMessage({
                command: 'queryResult',
                result
            });

            // Refresh tables list in case schema changed
            this.sendTables();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`❌ Query failed: ${errorMessage}`);

            this._panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    public dispose() {
        SQLitePanel.currentPanel = undefined;
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
    <title>SQLite Manager</title>
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

        /* Top Bar */
        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 20px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
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

        .db-status {
            font-size: 12px;
            padding: 4px 12px;
            border-radius: 12px;
            background-color: var(--vscode-textBlockQuote-background);
        }

        .db-status.connected {
            background-color: #49cc9044;
            color: #49cc90;
        }

        .db-status.disconnected {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }

        .top-bar-actions {
            display: flex;
            gap: 10px;
        }

        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* Main Container */
        .main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        /* Sidebar */
        .sidebar {
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
        }

        .tables-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }

        .table-item {
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            margin-bottom: 4px;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .table-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .table-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            opacity: 0.6;
            font-size: 12px;
        }

        /* Content Area */
        .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .content-header {
            padding: 15px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
        }

        .content-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 10px;
        }

        .table-info {
            font-size: 12px;
            opacity: 0.7;
        }

        /* Tabs */
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBar-background);
        }

        .tab {
            padding: 10px 20px;
            background-color: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            font-size: 13px;
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
            flex: 1;
            overflow: hidden;
        }

        .tab-content.active {
            display: flex;
            flex-direction: column;
        }

        /* Query Editor */
        .query-editor {
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        textarea {
            width: 100%;
            min-height: 120px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 10px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            resize: vertical;
        }

        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .query-actions {
            display: flex;
            gap: 10px;
        }

        /* Results Table */
        .results-container {
            flex: 1;
            overflow: auto;
            padding: 15px;
        }

        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .results-meta {
            font-size: 12px;
            opacity: 0.7;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }

        th, td {
            padding: 8px 12px;
            text-align: left;
            border: 1px solid var(--vscode-panel-border);
        }

        th {
            background-color: var(--vscode-sideBar-background);
            font-weight: 600;
            position: sticky;
            top: 0;
        }

        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        /* Schema View */
        .schema-container {
            flex: 1;
            overflow: auto;
            padding: 15px;
        }

        .schema-table {
            margin-bottom: 15px;
        }

        .column-row {
            display: grid;
            grid-template-columns: 200px 150px 100px 100px;
            gap: 10px;
            padding: 8px 12px;
            border: 1px solid var(--vscode-panel-border);
            font-size: 12px;
        }

        .column-row.header {
            background-color: var(--vscode-sideBar-background);
            font-weight: 600;
        }

        .column-row:not(.header):hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
        }

        .badge.pk {
            background-color: #61affe44;
            color: #61affe;
        }

        .badge.notnull {
            background-color: #fca13044;
            color: #fca130;
        }

        /* Loading */
        .loading {
            display: none;
            text-align: center;
            padding: 40px;
        }

        .loading.show {
            display: block;
        }

        .spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 4px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Error */
        .error-message {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            padding: 12px 15px;
            border-radius: 4px;
            margin: 15px;
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }

        .error-title {
            font-weight: 600;
            margin-bottom: 5px;
        }
    </style>
</head>
<body>
    <!-- Top Bar -->
    <div class="top-bar">
        <div class="top-bar-left">
            <div class="top-bar-title">
                <span>🗄️</span>
                <span>SQLite Manager</span>
            </div>
            <div class="db-status disconnected" id="db-status">
                Not Connected
            </div>
        </div>
        <div class="top-bar-actions">
            <button onclick="openDatabase()">📂 Open Database</button>
            <button onclick="createDatabase()">➕ Create Database</button>
            <button class="secondary" onclick="closeDatabase()" id="close-btn" disabled>✕ Close</button>
        </div>
    </div>

    <!-- Main Container -->
    <div class="main-container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">📋 Tables</div>
            <div class="tables-list" id="tables-list">
                <div class="empty-state">
                    <div>No database connected</div>
                    <div style="margin-top: 10px; font-size: 11px;">Open or create a database to get started</div>
                </div>
            </div>
        </div>

        <!-- Content Area -->
        <div class="content">
            <div class="tabs">
                <button class="tab active" onclick="switchTab('query')">🔍 Query</button>
                <button class="tab" id="data-tab" onclick="switchTab('data')" disabled>📊 Data</button>
                <button class="tab" id="schema-tab" onclick="switchTab('schema')" disabled>🏗️ Schema</button>
            </div>

            <!-- Query Tab -->
            <div class="tab-content active" id="query-content">
                <div class="query-editor">
                    <textarea id="query-input" placeholder="SELECT * FROM table_name&#10;&#10;-- Write your SQL query here..."></textarea>
                    <div class="query-actions">
                        <button onclick="executeQuery()" id="execute-btn">▶️ Execute</button>
                        <button class="secondary" onclick="clearQuery()">🗑️ Clear</button>
                        <button class="secondary" onclick="formatQuery()">✨ Format</button>
                    </div>
                </div>
                <div class="results-container" id="query-results">
                    <div class="empty-state">
                        <div style="font-size: 48px; margin-bottom: 10px;">🔍</div>
                        <div>Execute a query to see results</div>
                    </div>
                </div>
            </div>

            <!-- Data Tab -->
            <div class="tab-content" id="data-content">
                <div class="content-header" id="data-header" style="display: none;">
                    <div class="content-title" id="table-title">Table Data</div>
                    <div class="table-info" id="table-info">0 rows</div>
                </div>
                <div class="results-container" id="data-results">
                    <div class="empty-state">Select a table to view data</div>
                </div>
            </div>

            <!-- Schema Tab -->
            <div class="tab-content" id="schema-content">
                <div class="content-header" id="schema-header" style="display: none;">
                    <div class="content-title" id="schema-title">Table Schema</div>
                </div>
                <div class="schema-container" id="schema-results">
                    <div class="empty-state">Select a table to view schema</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentTable = null;
        let currentTabName = 'query';

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'connectionStatus':
                    updateConnectionStatus(message.isConnected, message.databaseName);
                    break;
                case 'updateTables':
                    renderTables(message.tables);
                    break;
                case 'updateTableColumns':
                    renderTableSchema(message.tableName, message.columns, message.rowCount);
                    break;
                case 'queryResult':
                    renderQueryResults(message.result, message.tableName);
                    break;
                case 'queryStarted':
                    showLoading();
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function openDatabase() {
            vscode.postMessage({ command: 'openDatabase' });
        }

        function createDatabase() {
            vscode.postMessage({ command: 'createDatabase' });
        }

        function closeDatabase() {
            vscode.postMessage({ command: 'closeDatabase' });
            currentTable = null;
            document.getElementById('tables-list').innerHTML = '<div class="empty-state">No database connected</div>';
        }

        function updateConnectionStatus(isConnected, databaseName) {
            const statusEl = document.getElementById('db-status');
            const closeBtn = document.getElementById('close-btn');

            if (isConnected) {
                statusEl.className = 'db-status connected';
                statusEl.textContent = \`Connected: \${databaseName}\`;
                closeBtn.disabled = false;
                vscode.postMessage({ command: 'getTables' });
            } else {
                statusEl.className = 'db-status disconnected';
                statusEl.textContent = 'Not Connected';
                closeBtn.disabled = true;
            }
        }

        function renderTables(tables) {
            const container = document.getElementById('tables-list');

            if (!tables || tables.length === 0) {
                container.innerHTML = '<div class="empty-state">No tables found</div>';
                return;
            }

            container.innerHTML = tables.map(table => \`
                <div class="table-item" onclick="selectTable('\${table.name}')">
                    <span>📋</span>
                    <span>\${table.name}</span>
                </div>
            \`).join('');
        }

        function selectTable(tableName) {
            currentTable = tableName;

            // Update active state
            document.querySelectorAll('.table-item').forEach(item => {
                item.classList.remove('active');
                if (item.textContent.includes(tableName)) {
                    item.classList.add('active');
                }
            });

            // Enable tabs
            document.getElementById('data-tab').disabled = false;
            document.getElementById('schema-tab').disabled = false;

            // Load table data
            vscode.postMessage({ command: 'getTableColumns', tableName });
            vscode.postMessage({ command: 'getTableData', tableName, limit: 100, offset: 0 });

            // Switch to data tab
            switchTab('data');
        }

        function switchTab(tabName) {
            currentTabName = tabName;

            // Update tabs
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            document.querySelector(\`.tab:nth-child(\${tabName === 'query' ? 1 : tabName === 'data' ? 2 : 3})\`).classList.add('active');
            document.getElementById(tabName + '-content').classList.add('active');
        }

        function executeQuery() {
            const query = document.getElementById('query-input').value.trim();
            if (!query) {
                alert('Please enter a query');
                return;
            }

            vscode.postMessage({ command: 'executeQuery', query });
        }

        function clearQuery() {
            document.getElementById('query-input').value = '';
        }

        function formatQuery() {
            const input = document.getElementById('query-input');
            const query = input.value.trim();

            // Simple SQL formatting
            const formatted = query
                .replace(/\\s+/g, ' ')
                .replace(/SELECT/gi, 'SELECT\\n  ')
                .replace(/FROM/gi, '\\nFROM')
                .replace(/WHERE/gi, '\\nWHERE')
                .replace(/ORDER BY/gi, '\\nORDER BY')
                .replace(/GROUP BY/gi, '\\nGROUP BY')
                .replace(/,/g, ',\\n  ');

            input.value = formatted;
        }

        function renderQueryResults(result, tableName) {
            const container = document.getElementById('query-results');

            if (!result || result.rows.length === 0) {
                container.innerHTML = '<div class="empty-state">No results</div>';
                return;
            }

            const html = \`
                <div class="results-header">
                    <div>
                        <strong>\${result.rowCount}</strong> row\${result.rowCount !== 1 ? 's' : ''} returned
                    </div>
                    <div class="results-meta">
                        Execution time: \${result.executionTime}ms
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            \${result.columns.map(col => \`<th>\${col}</th>\`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        \${result.rows.map(row => \`
                            <tr>
                                \${result.columns.map(col => \`<td>\${row[col] !== null ? row[col] : '<i>NULL</i>'}</td>\`).join('')}
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;

            container.innerHTML = html;

            // If tableName is provided, also update data tab
            if (tableName) {
                document.getElementById('data-results').innerHTML = html;
            }
        }

        function renderTableSchema(tableName, columns, rowCount) {
            const headerEl = document.getElementById('schema-header');
            const titleEl = document.getElementById('schema-title');
            const container = document.getElementById('schema-results');

            headerEl.style.display = 'block';
            titleEl.textContent = \`Schema: \${tableName}\`;

            const html = \`
                <div class="column-row header">
                    <div>Column Name</div>
                    <div>Type</div>
                    <div>Constraints</div>
                    <div>Default</div>
                </div>
                \${columns.map(col => \`
                    <div class="column-row">
                        <div>\${col.name}</div>
                        <div>\${col.type}</div>
                        <div>
                            \${col.pk ? '<span class="badge pk">PK</span> ' : ''}
                            \${col.notnull ? '<span class="badge notnull">NOT NULL</span>' : ''}
                        </div>
                        <div>\${col.dflt_value !== null ? col.dflt_value : '-'}</div>
                    </div>
                \`).join('')}
            \`;

            container.innerHTML = html;

            // Update data tab header
            document.getElementById('data-header').style.display = 'block';
            document.getElementById('table-title').textContent = tableName;
            document.getElementById('table-info').textContent = \`\${rowCount} rows\`;
        }

        function showLoading() {
            const container = document.getElementById('query-results');
            container.innerHTML = \`
                <div class="loading show">
                    <div class="spinner"></div>
                    <p style="margin-top: 20px;">Executing query...</p>
                </div>
            \`;
        }

        function showError(error) {
            const container = document.getElementById('query-results');
            container.innerHTML = \`
                <div class="error-message">
                    <div class="error-title">❌ Error</div>
                    <div>\${error}</div>
                </div>
            \`;
        }
    </script>
</body>
</html>`;
    }
}
