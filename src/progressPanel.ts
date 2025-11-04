import * as vscode from 'vscode';
import { DownloadManager, DownloadItem } from './downloadManager';

export class ProgressPanel {
    public static currentPanel: ProgressPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, private downloadManager: DownloadManager) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getHtmlContent();

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'cancel':
                        this.downloadManager.cancelDownload(message.id);
                        return;
                    case 'clearCompleted':
                        this.downloadManager.clearCompleted();
                        return;
                }
            },
            null,
            this._disposables
        );

        // Update webview when downloads change
        this.downloadManager.onDidChangeDownloads(() => {
            this.update();
        });

        // Periodic update for live progress
        const interval = setInterval(() => {
            this.update();
        }, 500);

        this._disposables.push(new vscode.Disposable(() => clearInterval(interval)));
    }

    public static createOrShow(downloadManager: DownloadManager) {
        if (ProgressPanel.currentPanel) {
            ProgressPanel.currentPanel._panel.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'downloadProgress',
            'Download Progress',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ProgressPanel.currentPanel = new ProgressPanel(panel, downloadManager);
    }

    private update() {
        const downloads = this.downloadManager.getDownloads();
        this._panel.webview.postMessage({
            command: 'update',
            downloads: downloads.map(d => ({
                ...d,
                progress: this.downloadManager.getProgress(d),
                formattedSize: this.downloadManager.formatBytes(d.downloadedSize),
                formattedTotal: this.downloadManager.formatBytes(d.totalSize),
                formattedSpeed: this.downloadManager.formatSpeed(d.speed)
            }))
        });
    }

    public dispose() {
        ProgressPanel.currentPanel = undefined;
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
    <title>Download Progress</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }

        h1 {
            margin-bottom: 20px;
            font-size: 24px;
            font-weight: 600;
        }

        .controls {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
        }

        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .download-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .download-item {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .download-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .download-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .download-name {
            font-weight: 600;
            font-size: 15px;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .download-status {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status-downloading {
            background-color: rgba(0, 122, 204, 0.2);
            color: #007ACC;
        }

        .status-completed {
            background-color: rgba(0, 200, 83, 0.2);
            color: #00C853;
        }

        .status-failed {
            background-color: rgba(244, 67, 54, 0.2);
            color: #F44336;
        }

        .status-pending {
            background-color: rgba(255, 193, 7, 0.2);
            color: #FFC107;
        }

        .download-url {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .progress-container {
            margin-bottom: 12px;
        }

        .progress-bar-bg {
            width: 100%;
            height: 8px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
        }

        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #007ACC, #00C853);
            border-radius: 4px;
            transition: width 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .progress-bar.downloading::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            right: 0;
            background: linear-gradient(
                90deg,
                rgba(255, 255, 255, 0) 0%,
                rgba(255, 255, 255, 0.3) 50%,
                rgba(255, 255, 255, 0) 100%
            );
            animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }

        .download-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin-top: 12px;
        }

        .stat {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .stat-value {
            font-size: 14px;
            font-weight: 600;
        }

        .download-actions {
            margin-top: 12px;
            display: flex;
            gap: 8px;
        }

        .action-btn {
            padding: 6px 12px;
            font-size: 12px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .action-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-state-text {
            font-size: 16px;
        }

        .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <h1>📥 Download Manager</h1>

    <div class="controls">
        <button onclick="clearCompleted()">Clear Completed</button>
    </div>

    <div id="downloads" class="download-list"></div>

    <script>
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'update') {
                renderDownloads(message.downloads);
            }
        });

        function renderDownloads(downloads) {
            const container = document.getElementById('downloads');

            if (downloads.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">No downloads yet</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = downloads.map(download => {
                const progress = download.progress || 0;
                const timeRemaining = calculateTimeRemaining(download);

                return \`
                    <div class="download-item">
                        <div class="download-header">
                            <div class="download-name">\${escapeHtml(download.fileName)}</div>
                            <div class="download-status status-\${download.status}">
                                \${download.status === 'downloading' ? '<span class="spinner"></span>' : ''}
                                \${download.status}
                            </div>
                        </div>
                        <div class="download-url">\${escapeHtml(download.url)}</div>

                        \${download.status === 'downloading' || download.status === 'pending' ? \`
                            <div class="progress-container">
                                <div class="progress-bar-bg">
                                    <div class="progress-bar \${download.status}" style="width: \${progress}%"></div>
                                </div>
                            </div>
                            <div class="download-stats">
                                <div class="stat">
                                    <div class="stat-label">Progress</div>
                                    <div class="stat-value">\${progress.toFixed(1)}%</div>
                                </div>
                                <div class="stat">
                                    <div class="stat-label">Downloaded</div>
                                    <div class="stat-value">\${download.formattedSize} / \${download.formattedTotal}</div>
                                </div>
                                <div class="stat">
                                    <div class="stat-label">Speed</div>
                                    <div class="stat-value">\${download.formattedSpeed}</div>
                                </div>
                                \${timeRemaining ? \`
                                    <div class="stat">
                                        <div class="stat-label">Time Remaining</div>
                                        <div class="stat-value">\${timeRemaining}</div>
                                    </div>
                                \` : ''}
                            </div>
                        \` : ''}

                        \${download.status === 'completed' ? \`
                            <div class="download-stats">
                                <div class="stat">
                                    <div class="stat-label">Size</div>
                                    <div class="stat-value">\${download.formattedTotal}</div>
                                </div>
                                <div class="stat">
                                    <div class="stat-label">Location</div>
                                    <div class="stat-value" style="font-size: 12px;">\${escapeHtml(download.savePath || 'N/A')}</div>
                                </div>
                            </div>
                        \` : ''}

                        \${download.status === 'failed' ? \`
                            <div class="download-stats">
                                <div class="stat">
                                    <div class="stat-label">Error</div>
                                    <div class="stat-value" style="color: #F44336;">\${escapeHtml(download.error || 'Unknown error')}</div>
                                </div>
                            </div>
                        \` : ''}

                        \${download.status === 'downloading' ? \`
                            <div class="download-actions">
                                <button class="action-btn" onclick="cancelDownload('\${download.id}')">Cancel</button>
                            </div>
                        \` : ''}
                    </div>
                \`;
            }).join('');
        }

        function calculateTimeRemaining(download) {
            if (download.status !== 'downloading' || download.speed === 0 || download.totalSize === 0) {
                return null;
            }

            const remaining = (download.totalSize - download.downloadedSize) / download.speed;
            return formatTime(remaining);
        }

        function formatTime(seconds) {
            if (seconds < 60) {
                return \`\${Math.round(seconds)}s\`;
            } else if (seconds < 3600) {
                const minutes = Math.floor(seconds / 60);
                const secs = Math.round(seconds % 60);
                return \`\${minutes}m \${secs}s\`;
            } else {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return \`\${hours}h \${minutes}m\`;
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function cancelDownload(id) {
            vscode.postMessage({ command: 'cancel', id });
        }

        function clearCompleted() {
            vscode.postMessage({ command: 'clearCompleted' });
        }
    </script>
</body>
</html>`;
    }
}
