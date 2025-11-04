import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DownloadManager } from './downloadManager';

export class FileTransferMonitor {
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private activeTransfers = new Map<string, { size: number; startTime: number }>();

    constructor(
        private downloadManager: DownloadManager,
        private outputChannel: vscode.OutputChannel
    ) {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        // Monitor downloads folder for new files
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const downloadsPattern = new vscode.RelativePattern(
                workspaceFolders[0],
                'downloads/**/*'
            );
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(downloadsPattern);

            this.fileWatcher.onDidCreate((uri) => {
                this.outputChannel.appendLine(`File created: ${uri.fsPath}`);
            });

            this.fileWatcher.onDidChange((uri) => {
                this.outputChannel.appendLine(`File changed: ${uri.fsPath}`);
            });
        }
    }

    /**
     * Download a remote file with progress tracking
     */
    public async downloadRemoteFile(sourceUri: vscode.Uri, destinationUri?: vscode.Uri): Promise<void> {
        try {
            const fileName = path.basename(sourceUri.fsPath);

            // Get destination
            let destUri = destinationUri;
            if (!destUri) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const downloadsDir = path.join(workspaceFolders[0].uri.fsPath, 'downloads');
                    if (!fs.existsSync(downloadsDir)) {
                        fs.mkdirSync(downloadsDir, { recursive: true });
                    }
                    destUri = vscode.Uri.file(path.join(downloadsDir, fileName));
                } else {
                    // Ask user for save location
                    destUri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(fileName),
                        saveLabel: 'Download'
                    });
                    if (!destUri) {
                        return; // User cancelled
                    }
                }
            }

            this.outputChannel.appendLine(`Starting download: ${sourceUri.fsPath} -> ${destUri.fsPath}`);

            // Start progress notification
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading ${fileName}`,
                    cancellable: true
                },
                async (progress, token) => {
                    try {
                        // Get file stats to show total size
                        let totalSize = 0;
                        try {
                            const stat = await vscode.workspace.fs.stat(sourceUri);
                            totalSize = stat.size;
                            this.outputChannel.appendLine(`File size: ${this.formatBytes(totalSize)}`);
                        } catch (err) {
                            this.outputChannel.appendLine('Could not determine file size');
                        }

                        // Read the source file in chunks
                        const sourceData = await vscode.workspace.fs.readFile(sourceUri);

                        if (token.isCancellationRequested) {
                            this.outputChannel.appendLine('Download cancelled by user');
                            return;
                        }

                        // Simulate progress updates for large files
                        const chunkSize = 1024 * 1024; // 1MB chunks
                        let written = 0;

                        if (sourceData.length > chunkSize) {
                            // For large files, write in chunks with progress updates
                            const chunks: Uint8Array[] = [];
                            for (let i = 0; i < sourceData.length; i += chunkSize) {
                                if (token.isCancellationRequested) {
                                    this.outputChannel.appendLine('Download cancelled by user');
                                    return;
                                }

                                const chunk = sourceData.slice(i, Math.min(i + chunkSize, sourceData.length));
                                chunks.push(chunk);
                                written += chunk.length;

                                const percentage = totalSize > 0 ? (written / totalSize) * 100 : 0;
                                progress.report({
                                    message: `${this.formatBytes(written)}${totalSize > 0 ? ' / ' + this.formatBytes(totalSize) : ''} (${percentage.toFixed(1)}%)`,
                                    increment: (chunk.length / sourceData.length) * 100
                                });

                                // Small delay to show progress
                                await new Promise(resolve => setTimeout(resolve, 10));
                            }

                            // Combine chunks and write
                            const combined = new Uint8Array(sourceData.length);
                            let offset = 0;
                            for (const chunk of chunks) {
                                combined.set(chunk, offset);
                                offset += chunk.length;
                            }
                            await vscode.workspace.fs.writeFile(destUri!, combined);
                        } else {
                            // Small file, write directly
                            await vscode.workspace.fs.writeFile(destUri!, sourceData);
                            progress.report({ message: 'Complete', increment: 100 });
                        }

                        this.outputChannel.appendLine(`✓ Download completed: ${destUri!.fsPath}`);

                        // Show completion notification
                        const action = await vscode.window.showInformationMessage(
                            `Downloaded ${fileName}`,
                            'Open File',
                            'Show in Folder'
                        );

                        if (action === 'Open File') {
                            await vscode.commands.executeCommand('vscode.open', destUri);
                        } else if (action === 'Show in Folder') {
                            await vscode.commands.executeCommand('revealFileInOS', destUri);
                        }

                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        this.outputChannel.appendLine(`✗ Download failed: ${errorMessage}`);
                        vscode.window.showErrorMessage(`Download failed: ${errorMessage}`);
                        throw error;
                    }
                }
            );

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`Error: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Download file from URL with our download manager integration
     */
    public async downloadFromUrl(url: string, fileName?: string): Promise<void> {
        await this.downloadManager.startDownload(url, fileName);
    }

    /**
     * Copy/download a file with progress (for local or remote files)
     */
    public async copyWithProgress(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
        const fileName = path.basename(source.fsPath);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Copying ${fileName}`,
                cancellable: true
            },
            async (progress, token) => {
                try {
                    const data = await vscode.workspace.fs.readFile(source);

                    if (token.isCancellationRequested) {
                        return;
                    }

                    await vscode.workspace.fs.writeFile(destination, data);
                    progress.report({ increment: 100 });

                    vscode.window.showInformationMessage(`Copied ${fileName}`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Copy failed: ${errorMessage}`);
                }
            }
        );
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    public dispose() {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
