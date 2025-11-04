import * as vscode from 'vscode';
import { ClipboardManager, ClipboardItem } from './clipboardManager';

export class ClipboardHistoryProvider implements vscode.TreeDataProvider<ClipboardTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ClipboardTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private clipboardManager: ClipboardManager) {
        clipboardManager.onDidChangeHistory(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ClipboardTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ClipboardTreeItem): Thenable<ClipboardTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items = this.clipboardManager.getHistory();

        if (items.length === 0) {
            return Promise.resolve([]);
        }

        return Promise.resolve(
            items.map(item => new ClipboardTreeItem(item, this.clipboardManager))
        );
    }
}

class ClipboardTreeItem extends vscode.TreeItem {
    constructor(
        public readonly clipboardItem: ClipboardItem,
        private clipboardManager: ClipboardManager
    ) {
        super(clipboardItem.content.substring(0, 50), vscode.TreeItemCollapsibleState.None);

        this.description = this.getDescription();
        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        this.contextValue = clipboardItem.isPinned ? 'pinnedClipboardItem' : 'clipboardItem';

        this.command = {
            command: 'toolbox.clipboardCopy',
            title: 'Copy to Clipboard',
            arguments: [clipboardItem]
        };
    }

    private getDescription(): string {
        const age = this.getTimeAgo(this.clipboardItem.timestamp);
        const type = this.clipboardItem.type === 'url' ? '🔗' :
                     this.clipboardItem.type === 'code' ? '💻' : '📝';
        return `${type} ${age}${this.clipboardItem.isPinned ? ' 📌' : ''}`;
    }

    private getTooltip(): string {
        const lines = [
            `Type: ${this.clipboardItem.type}`,
            `Time: ${new Date(this.clipboardItem.timestamp).toLocaleString()}`,
            `Length: ${this.clipboardItem.content.length} characters`,
            '',
            this.clipboardItem.content.substring(0, 200)
        ];

        if (this.clipboardItem.content.length > 200) {
            lines.push('...');
        }

        return lines.join('\n');
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.clipboardItem.isPinned) {
            return new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.yellow'));
        }

        switch (this.clipboardItem.type) {
            case 'url':
                return new vscode.ThemeIcon('link', new vscode.ThemeColor('charts.blue'));
            case 'code':
                return new vscode.ThemeIcon('code', new vscode.ThemeColor('charts.green'));
            default:
                return new vscode.ThemeIcon('symbol-text');
        }
    }

    private getTimeAgo(timestamp: number): string {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
}
