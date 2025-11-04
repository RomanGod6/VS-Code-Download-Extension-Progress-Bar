import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class TextUtilities {
    constructor(private outputChannel: vscode.OutputChannel) {}

    // Hash functions
    public async hashText(algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' = 'sha256') {
        const editor = vscode.window.activeTextEditor;
        const text = editor?.document.getText(editor.selection) ||
                     await vscode.window.showInputBox({ prompt: 'Enter text to hash' });

        if (!text) return;

        const hash = crypto.createHash(algorithm).update(text).digest('hex');

        await vscode.env.clipboard.writeText(hash);
        vscode.window.showInformationMessage(`${algorithm.toUpperCase()} hash copied to clipboard!`, 'Show')
            .then(action => {
                if (action === 'Show') {
                    this.showInNewFile(hash, `${algorithm}-hash.txt`);
                }
            });

        this.outputChannel.appendLine(`${algorithm.toUpperCase()} Hash: ${hash}`);
    }

    // Base64 encoding/decoding
    public async encodeBase64() {
        const text = await this.getTextFromEditorOrInput('Enter text to encode');
        if (!text) return;

        const encoded = Buffer.from(text, 'utf-8').toString('base64');
        await this.copyAndShow(encoded, 'Base64 encoded', 'base64.txt');
    }

    public async decodeBase64() {
        const text = await this.getTextFromEditorOrInput('Enter Base64 text to decode');
        if (!text) return;

        try {
            const decoded = Buffer.from(text, 'base64').toString('utf-8');
            await this.copyAndShow(decoded, 'Base64 decoded', 'decoded.txt');
        } catch (error) {
            vscode.window.showErrorMessage('Invalid Base64 string');
        }
    }

    // URL encoding/decoding
    public async encodeURL() {
        const text = await this.getTextFromEditorOrInput('Enter text to URL encode');
        if (!text) return;

        const encoded = encodeURIComponent(text);
        await this.copyAndShow(encoded, 'URL encoded', 'url-encoded.txt');
    }

    public async decodeURL() {
        const text = await this.getTextFromEditorOrInput('Enter URL encoded text to decode');
        if (!text) return;

        try {
            const decoded = decodeURIComponent(text);
            await this.copyAndShow(decoded, 'URL decoded', 'url-decoded.txt');
        } catch (error) {
            vscode.window.showErrorMessage('Invalid URL encoded string');
        }
    }

    // JSON formatting
    public async formatJSON() {
        const text = await this.getTextFromEditorOrInput('Enter JSON to format');
        if (!text) return;

        try {
            const parsed = JSON.parse(text);
            const formatted = JSON.stringify(parsed, null, 2);
            await this.replaceOrShow(formatted, 'JSON formatted');
        } catch (error) {
            vscode.window.showErrorMessage('Invalid JSON');
        }
    }

    public async minifyJSON() {
        const text = await this.getTextFromEditorOrInput('Enter JSON to minify');
        if (!text) return;

        try {
            const parsed = JSON.parse(text);
            const minified = JSON.stringify(parsed);
            await this.replaceOrShow(minified, 'JSON minified');
        } catch (error) {
            vscode.window.showErrorMessage('Invalid JSON');
        }
    }

    // JSON to CSV conversion
    public async jsonToCSV() {
        const text = await this.getTextFromEditorOrInput('Enter JSON array to convert to CSV');
        if (!text) return;

        try {
            const data = JSON.parse(text);
            if (!Array.isArray(data) || data.length === 0) {
                vscode.window.showErrorMessage('Input must be a non-empty JSON array');
                return;
            }

            const csv = this.convertJSONToCSV(data);
            await this.showInNewFile(csv, 'output.csv');
        } catch (error) {
            vscode.window.showErrorMessage('Invalid JSON');
        }
    }

    private convertJSONToCSV(data: any[]): string {
        const headers = Object.keys(data[0]);
        const csvRows = [];

        // Add headers
        csvRows.push(headers.join(','));

        // Add rows
        for (const row of data) {
            const values = headers.map(header => {
                const value = row[header];
                const escaped = ('' + value).replace(/"/g, '\\"');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        }

        return csvRows.join('\n');
    }

    // CSV to JSON conversion
    public async csvToJSON() {
        const text = await this.getTextFromEditorOrInput('Enter CSV to convert to JSON');
        if (!text) return;

        try {
            const json = this.convertCSVToJSON(text);
            const formatted = JSON.stringify(json, null, 2);
            await this.showInNewFile(formatted, 'output.json');
        } catch (error) {
            vscode.window.showErrorMessage('Invalid CSV');
        }
    }

    private convertCSVToJSON(csv: string): any[] {
        const lines = csv.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const result = [];

        for (let i = 1; i < lines.length; i++) {
            const obj: any = {};
            const currentLine = lines[i].split(',');

            for (let j = 0; j < headers.length; j++) {
                const value = currentLine[j]?.trim().replace(/^"|"$/g, '');
                obj[headers[j]] = value;
            }

            result.push(obj);
        }

        return result;
    }

    // Case conversion
    public async caseConverter() {
        const text = await this.getTextFromEditorOrInput('Enter text to convert');
        if (!text) return;

        const options = [
            'camelCase',
            'PascalCase',
            'snake_case',
            'SCREAMING_SNAKE_CASE',
            'kebab-case',
            'lowercase',
            'UPPERCASE',
            'Title Case'
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select case conversion'
        });

        if (!selected) return;

        let converted: string;
        switch (selected) {
            case 'camelCase':
                converted = this.toCamelCase(text);
                break;
            case 'PascalCase':
                converted = this.toPascalCase(text);
                break;
            case 'snake_case':
                converted = this.toSnakeCase(text);
                break;
            case 'SCREAMING_SNAKE_CASE':
                converted = this.toSnakeCase(text).toUpperCase();
                break;
            case 'kebab-case':
                converted = this.toKebabCase(text);
                break;
            case 'lowercase':
                converted = text.toLowerCase();
                break;
            case 'UPPERCASE':
                converted = text.toUpperCase();
                break;
            case 'Title Case':
                converted = this.toTitleCase(text);
                break;
            default:
                return;
        }

        await this.replaceOrShow(converted, `Converted to ${selected}`);
    }

    private toCamelCase(text: string): string {
        return text.replace(/[-_\s](.)/g, (_, c) => c.toUpperCase())
                   .replace(/^(.)/, c => c.toLowerCase());
    }

    private toPascalCase(text: string): string {
        return text.replace(/[-_\s](.)/g, (_, c) => c.toUpperCase())
                   .replace(/^(.)/, c => c.toUpperCase());
    }

    private toSnakeCase(text: string): string {
        return text.replace(/([A-Z])/g, '_$1')
                   .replace(/[-\s]/g, '_')
                   .replace(/^_/, '')
                   .toLowerCase();
    }

    private toKebabCase(text: string): string {
        return text.replace(/([A-Z])/g, '-$1')
                   .replace(/[_\s]/g, '-')
                   .replace(/^-/, '')
                   .toLowerCase();
    }

    private toTitleCase(text: string): string {
        return text.replace(/\w\S*/g, txt =>
            txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
    }

    // Lorem Ipsum generator
    public async generateLoremIpsum() {
        const paragraphs = await vscode.window.showInputBox({
            prompt: 'How many paragraphs?',
            value: '3',
            validateInput: (value) => {
                const num = parseInt(value);
                if (isNaN(num) || num < 1 || num > 100) {
                    return 'Enter a number between 1 and 100';
                }
                return null;
            }
        });

        if (!paragraphs) return;

        const count = parseInt(paragraphs);
        const lorem = this.loremIpsum(count);

        await this.showInNewFile(lorem, 'lorem-ipsum.txt');
    }

    private loremIpsum(paragraphs: number): string {
        const lorem = [
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
            'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
            'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
            'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.',
            'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa.'
        ];

        const result = [];
        for (let i = 0; i < paragraphs; i++) {
            result.push(lorem[i % lorem.length]);
        }

        return result.join('\n\n');
    }

    // Helper methods
    private async getTextFromEditorOrInput(prompt: string): Promise<string | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            return editor.document.getText(editor.selection);
        }
        return await vscode.window.showInputBox({ prompt });
    }

    private async copyAndShow(text: string, message: string, filename: string) {
        await vscode.env.clipboard.writeText(text);
        const action = await vscode.window.showInformationMessage(
            `${message} and copied to clipboard!`,
            'Show'
        );

        if (action === 'Show') {
            await this.showInNewFile(text, filename);
        }
    }

    private async replaceOrShow(text: string, message: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            await editor.edit(editBuilder => {
                editBuilder.replace(editor.selection, text);
            });
            vscode.window.showInformationMessage(message);
        } else {
            await this.copyAndShow(text, message, 'output.txt');
        }
    }

    private async showInNewFile(content: string, filename: string) {
        const doc = await vscode.workspace.openTextDocument({
            content,
            language: filename.endsWith('.json') ? 'json' :
                     filename.endsWith('.csv') ? 'csv' : 'plaintext'
        });
        await vscode.window.showTextDocument(doc);
    }
}
