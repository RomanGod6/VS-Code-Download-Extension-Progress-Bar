import * as vscode from 'vscode';
import { DownloadManager } from './downloadManager';
import { DownloadTreeProvider } from './downloadTreeProvider';
import { ProgressPanel } from './progressPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Download Progress Tracker extension is now active');

    const outputChannel = vscode.window.createOutputChannel('Download Progress');
    const downloadManager = new DownloadManager(outputChannel);
    const treeProvider = new DownloadTreeProvider(downloadManager);

    // Register tree view
    const treeView = vscode.window.createTreeView('downloadProgressView', {
        treeDataProvider: treeProvider,
        showCollapseAll: false
    });

    // Register commands
    const startDownloadCommand = vscode.commands.registerCommand(
        'downloadProgress.startDownload',
        async () => {
            const url = await vscode.window.showInputBox({
                prompt: 'Enter the URL to download',
                placeHolder: 'https://example.com/file.zip',
                validateInput: (value) => {
                    if (!value) {
                        return 'URL is required';
                    }
                    try {
                        new URL(value);
                        return null;
                    } catch {
                        return 'Please enter a valid URL';
                    }
                }
            });

            if (url) {
                const fileName = await vscode.window.showInputBox({
                    prompt: 'Enter file name (optional)',
                    placeHolder: 'Leave empty to use default name'
                });

                try {
                    const id = await downloadManager.startDownload(url, fileName || undefined);
                    vscode.window.showInformationMessage(`Download started: ${url}`);
                    outputChannel.appendLine(`Started download: ${url} (ID: ${id})`);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to start download: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        }
    );

    const showProgressCommand = vscode.commands.registerCommand(
        'downloadProgress.showProgress',
        () => {
            ProgressPanel.createOrShow(downloadManager);
        }
    );

    const testDownloadCommand = vscode.commands.registerCommand(
        'downloadProgress.testDownload',
        async () => {
            // Test URLs with different file types and sizes
            const testUrls = [
                {
                    name: 'Small JSON File (1KB)',
                    url: 'https://jsonplaceholder.typicode.com/posts'
                },
                {
                    name: 'Medium Image (100KB)',
                    url: 'https://picsum.photos/1000/1000'
                },
                {
                    name: 'Large File Demo (10MB)',
                    url: 'https://speed.hetzner.de/10MB.bin'
                }
            ];

            const selected = await vscode.window.showQuickPick(
                testUrls.map(t => t.name),
                { placeHolder: 'Select a test download' }
            );

            if (selected) {
                const test = testUrls.find(t => t.name === selected);
                if (test) {
                    try {
                        await downloadManager.startDownload(test.url);
                        vscode.window.showInformationMessage(`Test download started: ${test.name}`);
                        ProgressPanel.createOrShow(downloadManager);
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to start test download: ${error instanceof Error ? error.message : 'Unknown error'}`
                        );
                    }
                }
            }
        }
    );

    const clearCompletedCommand = vscode.commands.registerCommand(
        'downloadProgress.clearCompleted',
        () => {
            downloadManager.clearCompleted();
            vscode.window.showInformationMessage('Cleared completed downloads');
        }
    );

    const cancelDownloadCommand = vscode.commands.registerCommand(
        'downloadProgress.cancelDownload',
        (item) => {
            if (item && item.downloadItem) {
                downloadManager.cancelDownload(item.downloadItem.id);
                vscode.window.showInformationMessage(`Cancelled download: ${item.downloadItem.fileName}`);
            }
        }
    );

    const openFileCommand = vscode.commands.registerCommand(
        'downloadProgress.openFile',
        (item) => {
            if (item && item.downloadItem && item.downloadItem.savePath) {
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.downloadItem.savePath));
            }
        }
    );

    const revealFileCommand = vscode.commands.registerCommand(
        'downloadProgress.revealFile',
        (item) => {
            if (item && item.downloadItem && item.downloadItem.savePath) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.downloadItem.savePath));
            }
        }
    );

    context.subscriptions.push(
        treeView,
        startDownloadCommand,
        showProgressCommand,
        testDownloadCommand,
        clearCompletedCommand,
        cancelDownloadCommand,
        openFileCommand,
        revealFileCommand,
        outputChannel
    );

    // Show welcome message
    vscode.window.showInformationMessage(
        'Download Progress Tracker is ready! Try the test download to see it in action.',
        'Test Download',
        'Show Panel'
    ).then(selection => {
        if (selection === 'Test Download') {
            vscode.commands.executeCommand('downloadProgress.testDownload');
        } else if (selection === 'Show Panel') {
            vscode.commands.executeCommand('downloadProgress.showProgress');
        }
    });
}

export function deactivate() {
    console.log('Download Progress Tracker extension is now deactivated');
}
