import * as vscode from 'vscode';

export interface ClipboardItem {
    id: string;
    content: string;
    timestamp: number;
    type: 'text' | 'url' | 'code';
    isPinned: boolean;
}

export class ClipboardManager {
    private history: ClipboardItem[] = [];
    private maxHistorySize: number = 50;
    private lastClipboardContent: string = '';
    private checkInterval: NodeJS.Timeout | undefined;
    private _onDidChangeHistory = new vscode.EventEmitter<void>();
    public readonly onDidChangeHistory = this._onDidChangeHistory.event;

    constructor(
        private outputChannel: vscode.OutputChannel,
        private context: vscode.ExtensionContext
    ) {
        this.loadHistory();
        this.startMonitoring();
    }

    private loadHistory() {
        const saved = this.context.globalState.get<ClipboardItem[]>('clipboardHistory', []);
        this.history = saved;
    }

    private async saveHistory() {
        await this.context.globalState.update('clipboardHistory', this.history);
    }

    public startMonitoring() {
        // Check clipboard every 500ms
        this.checkInterval = setInterval(async () => {
            await this.checkClipboard();
        }, 500);
    }

    private async checkClipboard() {
        try {
            const content = await vscode.env.clipboard.readText();

            if (content && content !== this.lastClipboardContent && content.trim().length > 0) {
                this.lastClipboardContent = content;
                await this.addToHistory(content);
            }
        } catch (error) {
            // Clipboard access might fail, ignore
        }
    }

    private async addToHistory(content: string) {
        const type = this.detectType(content);

        const item: ClipboardItem = {
            id: Date.now().toString(),
            content,
            timestamp: Date.now(),
            type,
            isPinned: false
        };

        // Add to beginning
        this.history.unshift(item);

        // Remove duplicates (keep only the most recent)
        const seen = new Set<string>();
        this.history = this.history.filter(item => {
            if (item.isPinned) return true; // Always keep pinned items
            if (seen.has(item.content)) return false;
            seen.add(item.content);
            return true;
        });

        // Limit size (but keep all pinned items)
        const pinnedItems = this.history.filter(item => item.isPinned);
        const unpinnedItems = this.history.filter(item => !item.isPinned).slice(0, this.maxHistorySize);
        this.history = [...pinnedItems, ...unpinnedItems];

        await this.saveHistory();
        this._onDidChangeHistory.fire();

        // Show notification for URLs
        if (type === 'url' && this.shouldNotifyForURL()) {
            this.showURLNotification(content);
        }
    }

    private detectType(content: string): 'text' | 'url' | 'code' {
        const trimmed = content.trim();

        // Check if it's a URL
        try {
            const url = new URL(trimmed);
            if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:') {
                return 'url';
            }
        } catch {
            // Not a valid URL
        }

        // Check if it looks like code (contains common programming patterns)
        if (this.looksLikeCode(trimmed)) {
            return 'code';
        }

        return 'text';
    }

    private looksLikeCode(text: string): boolean {
        const codePatterns = [
            /function\s+\w+\s*\(/,
            /const\s+\w+\s*=/,
            /let\s+\w+\s*=/,
            /var\s+\w+\s*=/,
            /class\s+\w+/,
            /import\s+.*from/,
            /export\s+(default\s+)?/,
            /if\s*\(.+\)\s*\{/,
            /for\s*\(.+\)\s*\{/,
            /while\s*\(.+\)\s*\{/,
            /<\w+[^>]*>/,  // HTML tags
            /\{\s*\w+:\s*.+\}/  // Object literals
        ];

        return codePatterns.some(pattern => pattern.test(text));
    }

    private shouldNotifyForURL(): boolean {
        const config = vscode.workspace.getConfiguration('toolbox');
        return config.get<boolean>('clipboard.detectURLs', true);
    }

    private async showURLNotification(url: string) {
        const action = await vscode.window.showInformationMessage(
            `URL copied: ${this.truncate(url, 50)}`,
            'Download Now',
            'Dismiss'
        );

        if (action === 'Download Now') {
            vscode.commands.executeCommand('downloadProgress.startDownload');
        }
    }

    private truncate(str: string, maxLength: number): string {
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength - 3) + '...';
    }

    public getHistory(): ClipboardItem[] {
        return this.history;
    }

    public async copyToClipboard(content: string) {
        await vscode.env.clipboard.writeText(content);
        this.lastClipboardContent = content;
    }

    public async togglePin(id: string) {
        const item = this.history.find(item => item.id === id);
        if (item) {
            item.isPinned = !item.isPinned;
            await this.saveHistory();
            this._onDidChangeHistory.fire();
        }
    }

    public async deleteItem(id: string) {
        this.history = this.history.filter(item => item.id !== id);
        await this.saveHistory();
        this._onDidChangeHistory.fire();
    }

    public async clearHistory() {
        const pinnedItems = this.history.filter(item => item.isPinned);
        this.history = pinnedItems;
        await this.saveHistory();
        this._onDidChangeHistory.fire();
    }

    public dispose() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}
