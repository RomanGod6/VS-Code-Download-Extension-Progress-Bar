import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';

export class FileUtilities {
    constructor(private outputChannel: vscode.OutputChannel) {}

    /**
     * Generate file hash
     */
    public async hashFile(filePath?: string) {
        if (!filePath) {
            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select file to hash'
            });

            if (!files || files.length === 0) return;
            filePath = files[0].fsPath;
        }

        const algorithm = await vscode.window.showQuickPick(
            ['MD5', 'SHA-1', 'SHA-256', 'SHA-512'],
            { placeHolder: 'Select hash algorithm' }
        );

        if (!algorithm) return;

        try {
            const hash = await this.calculateFileHash(filePath, algorithm.toLowerCase().replace('-', ''));

            await vscode.env.clipboard.writeText(hash);

            const fileName = path.basename(filePath);
            vscode.window.showInformationMessage(
                `${algorithm} hash of ${fileName} copied to clipboard!`,
                'Show'
            ).then(action => {
                if (action === 'Show') {
                    this.outputChannel.show();
                }
            });

            this.outputChannel.appendLine(`\n${algorithm} Hash:`);
            this.outputChannel.appendLine(`File: ${filePath}`);
            this.outputChannel.appendLine(`Hash: ${hash}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to hash file: ${errorMessage}`);
        }
    }

    private calculateFileHash(filePath: string, algorithm: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash(algorithm);
            const stream = fs.createReadStream(filePath);

            stream.on('data', (chunk) => {
                hash.update(chunk);
            });

            stream.on('end', () => {
                resolve(hash.digest('hex'));
            });

            stream.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Extract archive
     */
    public async extractArchive(archivePath?: string) {
        if (!archivePath) {
            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    'Archives': ['zip', 'jar', 'war']
                },
                openLabel: 'Select archive to extract'
            });

            if (!files || files.length === 0) return;
            archivePath = files[0].fsPath;
        }

        const outputDir = path.join(path.dirname(archivePath), path.basename(archivePath, path.extname(archivePath)));

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Extracting ${path.basename(archivePath)}...`,
                    cancellable: false
                },
                async () => {
                    const zip = new AdmZip(archivePath!);
                    zip.extractAllTo(outputDir, true);
                }
            );

            const action = await vscode.window.showInformationMessage(
                `Archive extracted to ${outputDir}`,
                'Open Folder'
            );

            if (action === 'Open Folder') {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
            }

            this.outputChannel.appendLine(`✓ Extracted: ${archivePath} -> ${outputDir}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to extract archive: ${errorMessage}`);
            this.outputChannel.appendLine(`✗ Extraction failed: ${errorMessage}`);
        }
    }

    /**
     * Create archive from files/folders
     */
    public async createArchive(sourcePath?: string) {
        if (!sourcePath) {
            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFolders: true,
                canSelectFiles: true,
                openLabel: 'Select file or folder to archive'
            });

            if (!files || files.length === 0) return;
            sourcePath = files[0].fsPath;
        }

        const archiveName = await vscode.window.showInputBox({
            prompt: 'Enter archive name',
            value: path.basename(sourcePath) + '.zip'
        });

        if (!archiveName) return;

        const archivePath = path.join(path.dirname(sourcePath), archiveName);

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Creating archive ${archiveName}...`,
                    cancellable: false
                },
                async () => {
                    const zip = new AdmZip();

                    const stats = fs.statSync(sourcePath!);
                    if (stats.isDirectory()) {
                        zip.addLocalFolder(sourcePath!);
                    } else {
                        zip.addLocalFile(sourcePath!);
                    }

                    zip.writeZip(archivePath);
                }
            );

            const fileSize = fs.statSync(archivePath).size;
            const fileSizeStr = this.formatBytes(fileSize);

            const action = await vscode.window.showInformationMessage(
                `Archive created: ${archiveName} (${fileSizeStr})`,
                'Show in Folder'
            );

            if (action === 'Show in Folder') {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(archivePath));
            }

            this.outputChannel.appendLine(`✓ Created archive: ${archivePath} (${fileSizeStr})`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to create archive: ${errorMessage}`);
            this.outputChannel.appendLine(`✗ Archive creation failed: ${errorMessage}`);
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
