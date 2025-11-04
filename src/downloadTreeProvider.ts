import * as vscode from 'vscode';
import * as path from 'path';
import { DownloadManager, DownloadItem } from './downloadManager';

export class DownloadTreeProvider implements vscode.TreeDataProvider<DownloadTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DownloadTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private downloadManager: DownloadManager) {
        downloadManager.onDidChangeDownloads(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DownloadTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DownloadTreeItem): Thenable<DownloadTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const downloads = this.downloadManager.getDownloads();

        if (downloads.length === 0) {
            return Promise.resolve([]);
        }

        return Promise.resolve(
            downloads.map(download => new DownloadTreeItem(download, this.downloadManager))
        );
    }
}

export class DownloadTreeItem extends vscode.TreeItem {
    constructor(
        public readonly downloadItem: DownloadItem,
        private downloadManager: DownloadManager
    ) {
        super(downloadItem.fileName, vscode.TreeItemCollapsibleState.None);

        const progress = this.downloadManager.getProgress(downloadItem);
        const status = this.getStatusIcon(downloadItem.status);

        this.description = this.getDescription(downloadItem, progress);
        this.tooltip = this.getTooltip(downloadItem, progress);
        this.iconPath = this.getIcon(downloadItem.status);

        if (downloadItem.status === 'completed' && downloadItem.savePath) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(downloadItem.savePath)]
            };
        }

        this.contextValue = downloadItem.status;
    }

    private getDescription(item: DownloadItem, progress: number): string {
        switch (item.status) {
            case 'downloading':
                const speed = this.downloadManager.formatSpeed(item.speed);
                const downloaded = this.downloadManager.formatBytes(item.downloadedSize);
                const total = item.totalSize > 0 ? this.downloadManager.formatBytes(item.totalSize) : 'Unknown';
                return `${progress.toFixed(1)}% - ${downloaded}/${total} @ ${speed}`;
            case 'completed':
                return `✓ ${this.downloadManager.formatBytes(item.totalSize)}`;
            case 'failed':
                return `✗ ${item.error || 'Failed'}`;
            case 'pending':
                return 'Pending...';
            default:
                return '';
        }
    }

    private getTooltip(item: DownloadItem, progress: number): string {
        const lines: string[] = [
            `File: ${item.fileName}`,
            `URL: ${item.url}`,
            `Status: ${item.status}`,
        ];

        if (item.status === 'downloading') {
            lines.push(`Progress: ${progress.toFixed(2)}%`);
            lines.push(`Downloaded: ${this.downloadManager.formatBytes(item.downloadedSize)} / ${this.downloadManager.formatBytes(item.totalSize)}`);
            lines.push(`Speed: ${this.downloadManager.formatSpeed(item.speed)}`);

            if (item.speed > 0 && item.totalSize > 0) {
                const remaining = (item.totalSize - item.downloadedSize) / item.speed;
                lines.push(`Time remaining: ${this.formatTime(remaining)}`);
            }
        } else if (item.status === 'completed') {
            const duration = (Date.now() - item.startTime) / 1000;
            lines.push(`Size: ${this.downloadManager.formatBytes(item.totalSize)}`);
            lines.push(`Time: ${this.formatTime(duration)}`);
            if (item.savePath) {
                lines.push(`Path: ${item.savePath}`);
            }
        } else if (item.status === 'failed' && item.error) {
            lines.push(`Error: ${item.error}`);
        }

        return lines.join('\n');
    }

    private formatTime(seconds: number): string {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${minutes}m ${secs}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'downloading': return '⬇️';
            case 'completed': return '✓';
            case 'failed': return '✗';
            case 'pending': return '⏳';
            default: return '•';
        }
    }

    private getIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'downloading':
                return new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
            case 'completed':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            case 'pending':
                return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}
