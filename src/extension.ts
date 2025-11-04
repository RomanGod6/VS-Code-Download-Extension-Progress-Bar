import * as vscode from 'vscode';
import { DownloadManager } from './downloadManager';
import { DownloadTreeProvider } from './downloadTreeProvider';
import { ProgressPanel } from './progressPanel';
import { FileTransferMonitor } from './fileTransferMonitor';
import { ClipboardManager } from './clipboardManager';
import { ClipboardHistoryProvider } from './clipboardTreeProvider';
import { TextUtilities } from './textUtilities';
import { FileUtilities } from './fileUtilities';
import { QuickActionsProvider, QuickActionsUtility } from './quickActions';
import { APITester } from './apiTester';
import { APITestPanel } from './apiTestPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Developer Toolbox extension is now active!');

    const outputChannel = vscode.window.createOutputChannel('Developer Toolbox');

    // Initialize all managers and utilities
    const downloadManager = new DownloadManager(outputChannel);
    const fileTransferMonitor = new FileTransferMonitor(downloadManager, outputChannel);
    const clipboardManager = new ClipboardManager(outputChannel, context);
    const textUtilities = new TextUtilities(outputChannel);
    const fileUtilities = new FileUtilities(outputChannel);
    const quickActionsUtility = new QuickActionsUtility(outputChannel);
    const apiTester = new APITester(outputChannel, context);

    // Initialize tree providers
    const downloadTreeProvider = new DownloadTreeProvider(downloadManager);
    const clipboardHistoryProvider = new ClipboardHistoryProvider(clipboardManager);
    const quickActionsProvider = new QuickActionsProvider();

    // Register tree views
    const downloadTreeView = vscode.window.createTreeView('downloadProgressView', {
        treeDataProvider: downloadTreeProvider,
        showCollapseAll: false
    });

    const clipboardTreeView = vscode.window.createTreeView('toolboxClipboardHistory', {
        treeDataProvider: clipboardHistoryProvider,
        showCollapseAll: false
    });

    const quickActionsTreeView = vscode.window.createTreeView('toolboxQuickActions', {
        treeDataProvider: quickActionsProvider,
        showCollapseAll: false
    });

    // ===== DOWNLOAD COMMANDS =====

    const startDownloadCommand = vscode.commands.registerCommand(
        'downloadProgress.startDownload',
        async () => {
            const url = await vscode.window.showInputBox({
                prompt: 'Enter the URL to download',
                placeHolder: 'https://example.com/file.zip',
                validateInput: (value) => {
                    if (!value) return 'URL is required';
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
                    vscode.window.showInformationMessage(`Download started!`);
                    outputChannel.appendLine(`Started download: ${url} (ID: ${id})`);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to start download: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        }
    );

    const batchDownloadCommand = vscode.commands.registerCommand(
        'downloadProgress.batchDownload',
        async () => {
            const urls = await vscode.window.showInputBox({
                prompt: 'Enter URLs to download (one per line or comma-separated)',
                placeHolder: 'https://example.com/file1.zip, https://example.com/file2.zip',
                validateInput: (value) => {
                    if (!value) return 'At least one URL is required';
                    return null;
                }
            });

            if (!urls) return;

            const urlList = urls.split(/[\n,]/).map(u => u.trim()).filter(u => u.length > 0);

            if (urlList.length === 0) {
                vscode.window.showWarningMessage('No valid URLs provided');
                return;
            }

            for (const url of urlList) {
                try {
                    await downloadManager.startDownload(url);
                    outputChannel.appendLine(`Queued: ${url}`);
                } catch (error) {
                    outputChannel.appendLine(`Failed to queue: ${url}`);
                }
            }

            vscode.window.showInformationMessage(`Started ${urlList.length} downloads!`);
            ProgressPanel.createOrShow(downloadManager);
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
            const testUrls = [
                { name: 'Small JSON File (1KB)', url: 'https://jsonplaceholder.typicode.com/posts' },
                { name: 'Medium Image (100KB)', url: 'https://picsum.photos/1000/1000' },
                { name: 'Large File Demo (10MB)', url: 'https://speed.hetzner.de/10MB.bin' }
            ];

            const selected = await vscode.window.showQuickPick(
                testUrls.map(t => t.name),
                { placeHolder: 'Select a test download' }
            );

            if (selected) {
                const test = testUrls.find(t => t.name === selected);
                if (test) {
                    await downloadManager.startDownload(test.url);
                    vscode.window.showInformationMessage(`Test download started: ${test.name}`);
                    ProgressPanel.createOrShow(downloadManager);
                }
            }
        }
    );

    const downloadFileCommand = vscode.commands.registerCommand(
        'downloadProgress.downloadFile',
        async (uri: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('No file selected');
                return;
            }

            try {
                const isRemote = uri.scheme !== 'file';
                if (isRemote) {
                    await fileTransferMonitor.downloadRemoteFile(uri);
                } else {
                    const action = await vscode.window.showInformationMessage(
                        'This is a local file. Copy to downloads folder?',
                        'Yes', 'No'
                    );
                    if (action === 'Yes') {
                        await fileTransferMonitor.downloadRemoteFile(uri);
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to download: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    );

    const downloadFileToWorkspaceCommand = vscode.commands.registerCommand(
        'downloadProgress.downloadFileToWorkspace',
        async (uri: vscode.Uri) => {
            if (!uri) return;
            try {
                await fileTransferMonitor.downloadRemoteFile(uri);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
            if (item?.downloadItem) {
                downloadManager.cancelDownload(item.downloadItem.id);
                vscode.window.showInformationMessage(`Cancelled: ${item.downloadItem.fileName}`);
            }
        }
    );

    // ===== TEXT UTILITY COMMANDS =====

    const hashTextCommand = vscode.commands.registerCommand('toolbox.hashText', () => textUtilities.hashText());
    const encodeBase64Command = vscode.commands.registerCommand('toolbox.encodeBase64', () => textUtilities.encodeBase64());
    const decodeBase64Command = vscode.commands.registerCommand('toolbox.decodeBase64', () => textUtilities.decodeBase64());
    const encodeURLCommand = vscode.commands.registerCommand('toolbox.encodeURL', () => textUtilities.encodeURL());
    const decodeURLCommand = vscode.commands.registerCommand('toolbox.decodeURL', () => textUtilities.decodeURL());
    const formatJSONCommand = vscode.commands.registerCommand('toolbox.formatJSON', () => textUtilities.formatJSON());
    const minifyJSONCommand = vscode.commands.registerCommand('toolbox.minifyJSON', () => textUtilities.minifyJSON());
    const jsonToCSVCommand = vscode.commands.registerCommand('toolbox.jsonToCSV', () => textUtilities.jsonToCSV());
    const csvToJSONCommand = vscode.commands.registerCommand('toolbox.csvToJSON', () => textUtilities.csvToJSON());
    const caseConverterCommand = vscode.commands.registerCommand('toolbox.caseConverter', () => textUtilities.caseConverter());
    const loremIpsumCommand = vscode.commands.registerCommand('toolbox.loremIpsum', () => textUtilities.generateLoremIpsum());

    // ===== FILE UTILITY COMMANDS =====

    const hashFileCommand = vscode.commands.registerCommand('toolbox.hashFile', () => fileUtilities.hashFile());
    const extractArchiveCommand = vscode.commands.registerCommand('toolbox.extractArchive', () => fileUtilities.extractArchive());
    const createArchiveCommand = vscode.commands.registerCommand('toolbox.createArchive', () => fileUtilities.createArchive());

    // ===== QUICK ACTION COMMANDS =====

    const generateUUIDCommand = vscode.commands.registerCommand('toolbox.generateUUID', () => quickActionsUtility.generateUUID());
    const timestampToDateCommand = vscode.commands.registerCommand('toolbox.timestampToDate', () => quickActionsUtility.timestampToDate());
    const dateToTimestampCommand = vscode.commands.registerCommand('toolbox.dateToTimestamp', () => quickActionsUtility.dateToTimestamp());

    // ===== CLIPBOARD COMMANDS =====

    const clipboardHistoryCommand = vscode.commands.registerCommand(
        'toolbox.clipboardHistory',
        async () => {
            const items = clipboardManager.getHistory();

            if (items.length === 0) {
                vscode.window.showInformationMessage('Clipboard history is empty');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                items.map(item => ({
                    label: item.content.substring(0, 50) + (item.content.length > 50 ? '...' : ''),
                    description: item.type,
                    detail: new Date(item.timestamp).toLocaleString(),
                    item
                })),
                { placeHolder: 'Select item to copy' }
            );

            if (selected) {
                await clipboardManager.copyToClipboard(selected.item.content);
                vscode.window.showInformationMessage('Copied to clipboard!');
            }
        }
    );

    const clipboardCopyCommand = vscode.commands.registerCommand(
        'toolbox.clipboardCopy',
        async (item) => {
            if (item) {
                await clipboardManager.copyToClipboard(item.content);
                vscode.window.showInformationMessage('Copied to clipboard!');
            }
        }
    );

    const clipboardDeleteCommand = vscode.commands.registerCommand(
        'toolbox.clipboardDelete',
        async (item) => {
            if (item) {
                await clipboardManager.deleteItem(item.id);
            }
        }
    );

    const clipboardTogglePinCommand = vscode.commands.registerCommand(
        'toolbox.clipboardTogglePin',
        async (item) => {
            if (item) {
                await clipboardManager.togglePin(item.id);
            }
        }
    );

    const clipboardClearCommand = vscode.commands.registerCommand(
        'toolbox.clipboardClear',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear clipboard history (pinned items will be kept)?',
                'Clear', 'Cancel'
            );
            if (confirm === 'Clear') {
                await clipboardManager.clearHistory();
                vscode.window.showInformationMessage('Clipboard history cleared');
            }
        }
    );

    // ===== API TESTER COMMANDS =====

    const sendAPIRequestCommand = vscode.commands.registerCommand(
        'toolbox.sendAPIRequest',
        () => {
            APITestPanel.createOrShow(apiTester, outputChannel);
        }
    );

    const detectURLsInFileCommand = vscode.commands.registerCommand(
        'toolbox.detectURLsInFile',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor. Please open a file first.');
                return;
            }
            apiTester.detectAPIsInFile();
        }
    );

    // ===== MAIN TOOLBOX PANEL =====

    const showPanelCommand = vscode.commands.registerCommand(
        'toolbox.showPanel',
        () => {
            vscode.window.showInformationMessage(
                'Developer Toolbox is ready! Use the sidebar or Command Palette (Cmd/Ctrl+Shift+P)',
                'Show Downloads',
                'Quick Actions'
            ).then(action => {
                if (action === 'Show Downloads') {
                    ProgressPanel.createOrShow(downloadManager);
                } else if (action === 'Quick Actions') {
                    vscode.commands.executeCommand('toolboxQuickActions.focus');
                }
            });
        }
    );

    // Register all commands
    context.subscriptions.push(
        downloadTreeView,
        clipboardTreeView,
        quickActionsTreeView,
        startDownloadCommand,
        batchDownloadCommand,
        showProgressCommand,
        testDownloadCommand,
        downloadFileCommand,
        downloadFileToWorkspaceCommand,
        clearCompletedCommand,
        cancelDownloadCommand,
        hashTextCommand,
        encodeBase64Command,
        decodeBase64Command,
        encodeURLCommand,
        decodeURLCommand,
        formatJSONCommand,
        minifyJSONCommand,
        jsonToCSVCommand,
        csvToJSONCommand,
        caseConverterCommand,
        loremIpsumCommand,
        hashFileCommand,
        extractArchiveCommand,
        createArchiveCommand,
        generateUUIDCommand,
        timestampToDateCommand,
        dateToTimestampCommand,
        clipboardHistoryCommand,
        clipboardCopyCommand,
        clipboardDeleteCommand,
        clipboardTogglePinCommand,
        clipboardClearCommand,
        sendAPIRequestCommand,
        detectURLsInFileCommand,
        showPanelCommand,
        outputChannel,
        { dispose: () => fileTransferMonitor.dispose() },
        { dispose: () => clipboardManager.dispose() }
    );

    // Show welcome message
    outputChannel.appendLine('✓ Developer Toolbox activated successfully!');
    outputChannel.appendLine('Available utilities: Downloads, Text Tools, File Tools, Clipboard Manager, API Tester, and more!');
}

export function deactivate() {
    console.log('Developer Toolbox extension deactivated');
}
