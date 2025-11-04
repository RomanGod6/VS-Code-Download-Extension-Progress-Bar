import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

export class QuickActionsProvider implements vscode.TreeDataProvider<QuickAction> {
    private _onDidChangeTreeData = new vscode.EventEmitter<QuickAction | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QuickAction): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QuickAction): Thenable<QuickAction[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const actions: QuickAction[] = [
            // Download actions
            new QuickAction(
                'Download from URL',
                'Start a new download',
                'downloadProgress.startDownload',
                '$(cloud-download)'
            ),
            new QuickAction(
                'Batch Download',
                'Download multiple URLs',
                'downloadProgress.batchDownload',
                '$(list-ordered)'
            ),
            new QuickAction(
                'Show Downloads',
                'View active downloads',
                'downloadProgress.showProgress',
                '$(list-tree)'
            ),

            // Text utilities
            new QuickAction(
                'Generate UUID',
                'Create a new UUID',
                'toolbox.generateUUID',
                '$(key)'
            ),
            new QuickAction(
                'Hash Text',
                'Generate hash from text',
                'toolbox.hashText',
                '$(lock)'
            ),
            new QuickAction(
                'Encode Base64',
                'Encode text to Base64',
                'toolbox.encodeBase64',
                '$(symbol-key)'
            ),
            new QuickAction(
                'Decode Base64',
                'Decode Base64 to text',
                'toolbox.decodeBase64',
                '$(debug-reverse-continue)'
            ),

            // Format utilities
            new QuickAction(
                'Format JSON',
                'Pretty-print JSON',
                'toolbox.formatJSON',
                '$(symbol-property)'
            ),
            new QuickAction(
                'Minify JSON',
                'Compress JSON',
                'toolbox.minifyJSON',
                '$(chevron-down)'
            ),
            new QuickAction(
                'JSON to CSV',
                'Convert JSON to CSV',
                'toolbox.jsonToCSV',
                '$(arrow-swap)'
            ),
            new QuickAction(
                'CSV to JSON',
                'Convert CSV to JSON',
                'toolbox.csvToJSON',
                '$(arrow-swap)'
            ),

            // Time utilities
            new QuickAction(
                'Timestamp to Date',
                'Convert Unix timestamp',
                'toolbox.timestampToDate',
                '$(calendar)'
            ),
            new QuickAction(
                'Date to Timestamp',
                'Get Unix timestamp',
                'toolbox.dateToTimestamp',
                '$(clock)'
            ),

            // File utilities
            new QuickAction(
                'Hash File',
                'Generate file hash',
                'toolbox.hashFile',
                '$(file-binary)'
            ),
            new QuickAction(
                'Extract Archive',
                'Unzip/extract archive',
                'toolbox.extractArchive',
                '$(file-zip)'
            ),
            new QuickAction(
                'Create Archive',
                'Create ZIP archive',
                'toolbox.createArchive',
                '$(package)'
            ),

            // Other utilities
            new QuickAction(
                'Convert Text Case',
                'Change text casing',
                'toolbox.caseConverter',
                '$(symbol-text)'
            ),
            new QuickAction(
                'Lorem Ipsum',
                'Generate placeholder text',
                'toolbox.loremIpsum',
                '$(symbol-string)'
            ),
            new QuickAction(
                'Clipboard History',
                'View clipboard history',
                'toolbox.clipboardHistory',
                '$(clippy)'
            ),

            // API Testing
            new QuickAction(
                'Test API',
                'Send HTTP request',
                'toolbox.sendAPIRequest',
                '$(globe)'
            ),
            new QuickAction(
                'Detect APIs in File',
                'Find API calls in code',
                'toolbox.detectURLsInFile',
                '$(search)'
            )
        ];

        return Promise.resolve(actions);
    }
}

class QuickAction extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltipText: string,
        public readonly commandName: string,
        public readonly icon: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = tooltipText;
        this.command = {
            command: commandName,
            title: label
        };
        this.iconPath = new vscode.ThemeIcon(icon.replace('$(', '').replace(')', ''));
    }
}

export class QuickActionsUtility {
    constructor(private outputChannel: vscode.OutputChannel) {}

    public async generateUUID() {
        const uuid = uuidv4();
        await vscode.env.clipboard.writeText(uuid);

        const action = await vscode.window.showInformationMessage(
            'UUID copied to clipboard!',
            'Insert at Cursor',
            'Dismiss'
        );

        if (action === 'Insert at Cursor') {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, uuid);
                });
            }
        }

        this.outputChannel.appendLine(`Generated UUID: ${uuid}`);
    }

    public async timestampToDate() {
        const timestamp = await vscode.window.showInputBox({
            prompt: 'Enter Unix timestamp (seconds or milliseconds)',
            placeHolder: '1609459200'
        });

        if (!timestamp) return;

        try {
            const num = parseInt(timestamp);
            const date = num > 10000000000 ? new Date(num) : new Date(num * 1000);
            const dateStr = date.toISOString();

            await vscode.env.clipboard.writeText(dateStr);

            vscode.window.showInformationMessage(
                `Date: ${dateStr} (copied to clipboard)`,
                'Insert'
            ).then(action => {
                if (action === 'Insert') {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, dateStr);
                        });
                    }
                }
            });

            this.outputChannel.appendLine(`Timestamp: ${timestamp} -> Date: ${dateStr}`);
        } catch (error) {
            vscode.window.showErrorMessage('Invalid timestamp');
        }
    }

    public async dateToTimestamp() {
        const dateStr = await vscode.window.showInputBox({
            prompt: 'Enter date (ISO format or relative)',
            placeHolder: '2024-01-01 or "now" or "yesterday"'
        });

        if (!dateStr) return;

        try {
            let date: Date;

            if (dateStr.toLowerCase() === 'now') {
                date = new Date();
            } else if (dateStr.toLowerCase() === 'yesterday') {
                date = new Date();
                date.setDate(date.getDate() - 1);
            } else if (dateStr.toLowerCase() === 'tomorrow') {
                date = new Date();
                date.setDate(date.getDate() + 1);
            } else {
                date = new Date(dateStr);
            }

            const timestamp = Math.floor(date.getTime() / 1000);
            const timestampStr = timestamp.toString();

            await vscode.env.clipboard.writeText(timestampStr);

            vscode.window.showInformationMessage(
                `Timestamp: ${timestampStr} (copied to clipboard)`,
                'Insert'
            ).then(action => {
                if (action === 'Insert') {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, timestampStr);
                        });
                    }
                }
            });

            this.outputChannel.appendLine(`Date: ${dateStr} -> Timestamp: ${timestampStr}`);
        } catch (error) {
            vscode.window.showErrorMessage('Invalid date format');
        }
    }
}
