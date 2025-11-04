import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export interface DownloadItem {
    id: string;
    url: string;
    fileName: string;
    totalSize: number;
    downloadedSize: number;
    status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
    speed: number;
    startTime: number;
    error?: string;
    savePath?: string;
}

export class DownloadManager {
    private downloads: Map<string, DownloadItem> = new Map();
    private activeDownloads: Map<string, http.ClientRequest> = new Map();
    private _onDidChangeDownloads = new vscode.EventEmitter<void>();
    public readonly onDidChangeDownloads = this._onDidChangeDownloads.event;

    constructor(private outputChannel: vscode.OutputChannel) {}

    public async startDownload(url: string, fileName?: string): Promise<string> {
        const id = this.generateId();
        const downloadFileName = fileName || this.getFileNameFromUrl(url);

        const downloadItem: DownloadItem = {
            id,
            url,
            fileName: downloadFileName,
            totalSize: 0,
            downloadedSize: 0,
            status: 'pending',
            speed: 0,
            startTime: Date.now()
        };

        this.downloads.set(id, downloadItem);
        this._onDidChangeDownloads.fire();

        this.performDownload(id);

        return id;
    }

    private async performDownload(id: string): Promise<void> {
        const item = this.downloads.get(id);
        if (!item) return;

        try {
            item.status = 'downloading';
            this._onDidChangeDownloads.fire();

            const savePath = await this.getSavePath(item.fileName);
            item.savePath = savePath;

            const file = fs.createWriteStream(savePath);
            const protocol = item.url.startsWith('https') ? https : http;

            // Handle file stream errors
            file.on('error', (err) => {
                item.status = 'failed';
                item.error = `File write error: ${err.message}`;
                this._onDidChangeDownloads.fire();
                this.outputChannel.appendLine(`✗ File error: ${item.fileName} - ${err.message}`);
                vscode.window.showErrorMessage(`Download failed: ${err.message}`);
            });

            const request = protocol.get(item.url, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // Handle redirects
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        file.close();
                        item.url = redirectUrl;
                        this.performDownload(id);
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    file.close();
                    item.status = 'failed';
                    item.error = `HTTP ${response.statusCode}: ${response.statusMessage}`;
                    this._onDidChangeDownloads.fire();
                    this.outputChannel.appendLine(`✗ Download failed: ${item.fileName} - ${item.error}`);
                    vscode.window.showErrorMessage(`Download failed: ${item.error}`);
                    return;
                }

                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                item.totalSize = totalSize;
                this.outputChannel.appendLine(`Starting download: ${item.fileName} (${this.formatBytes(totalSize)})`);

                let downloadedSize = 0;
                let lastUpdate = Date.now();
                let lastDownloadedSize = 0;

                // Handle data chunks - write to file AND track progress
                response.on('data', (chunk: Buffer) => {
                    // Write chunk to file
                    file.write(chunk);

                    // Track progress
                    downloadedSize += chunk.length;
                    item.downloadedSize = downloadedSize;

                    const now = Date.now();
                    const timeDiff = (now - lastUpdate) / 1000; // seconds

                    if (timeDiff >= 0.2) { // Update speed every 0.2 seconds for smoother updates
                        const sizeDiff = downloadedSize - lastDownloadedSize;
                        item.speed = sizeDiff / timeDiff; // bytes per second
                        lastUpdate = now;
                        lastDownloadedSize = downloadedSize;
                        this._onDidChangeDownloads.fire();

                        // Log progress periodically
                        const progress = totalSize > 0 ? (downloadedSize / totalSize * 100).toFixed(1) : '?';
                        this.outputChannel.appendLine(
                            `Progress: ${progress}% - ${this.formatBytes(downloadedSize)} / ${this.formatBytes(totalSize)} @ ${this.formatSpeed(item.speed)}`
                        );
                    }
                });

                // Handle end of download
                response.on('end', () => {
                    file.end(() => {
                        item.status = 'completed';
                        item.speed = 0;
                        item.downloadedSize = downloadedSize;
                        this._onDidChangeDownloads.fire();
                        this.outputChannel.appendLine(`✓ Download completed: ${item.fileName} (${this.formatBytes(downloadedSize)})`);

                        vscode.window.showInformationMessage(
                            `Download completed: ${item.fileName}`,
                            'Open File',
                            'Show in Folder'
                        ).then(action => {
                            if (action === 'Open File' && item.savePath) {
                                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.savePath));
                            } else if (action === 'Show in Folder' && item.savePath) {
                                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.savePath));
                            }
                        });
                    });
                });

                // Handle response errors
                response.on('error', (err) => {
                    file.close();
                    item.status = 'failed';
                    item.error = err.message;
                    this._onDidChangeDownloads.fire();
                    this.outputChannel.appendLine(`✗ Response error: ${item.fileName} - ${err.message}`);
                    vscode.window.showErrorMessage(`Download failed: ${err.message}`);
                });
            });

            request.on('error', (err) => {
                item.status = 'failed';
                item.error = err.message;
                this._onDidChangeDownloads.fire();
                this.outputChannel.appendLine(`✗ Download failed: ${item.fileName} - ${err.message}`);
                vscode.window.showErrorMessage(`Download failed: ${err.message}`);
            });

            this.activeDownloads.set(id, request);

        } catch (error) {
            item.status = 'failed';
            item.error = error instanceof Error ? error.message : 'Unknown error';
            this._onDidChangeDownloads.fire();
        }
    }

    private generateId(): string {
        return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getFileNameFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const fileName = pathname.split('/').pop() || 'download';
            return fileName || 'download';
        } catch {
            return 'download';
        }
    }

    private async getSavePath(fileName: string): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let defaultPath: string;

        if (workspaceFolders && workspaceFolders.length > 0) {
            const downloadsDir = path.join(workspaceFolders[0].uri.fsPath, 'downloads');
            if (!fs.existsSync(downloadsDir)) {
                fs.mkdirSync(downloadsDir, { recursive: true });
            }
            defaultPath = downloadsDir;
        } else {
            defaultPath = require('os').homedir();
        }

        return path.join(defaultPath, fileName);
    }

    public getDownloads(): DownloadItem[] {
        return Array.from(this.downloads.values());
    }

    public getDownload(id: string): DownloadItem | undefined {
        return this.downloads.get(id);
    }

    public cancelDownload(id: string): void {
        const request = this.activeDownloads.get(id);
        if (request) {
            request.destroy();
            this.activeDownloads.delete(id);
        }

        const item = this.downloads.get(id);
        if (item) {
            item.status = 'failed';
            item.error = 'Cancelled by user';
            this._onDidChangeDownloads.fire();
        }
    }

    public clearCompleted(): void {
        for (const [id, item] of this.downloads.entries()) {
            if (item.status === 'completed' || item.status === 'failed') {
                this.downloads.delete(id);
            }
        }
        this._onDidChangeDownloads.fire();
    }

    public formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    public formatSpeed(bytesPerSecond: number): string {
        return this.formatBytes(bytesPerSecond) + '/s';
    }

    public getProgress(item: DownloadItem): number {
        if (item.totalSize === 0) return 0;
        return (item.downloadedSize / item.totalSize) * 100;
    }
}
