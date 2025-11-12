import * as vscode from 'vscode';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface SQLiteTable {
    name: string;
    sql: string;
}

export interface SQLiteColumn {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
}

export interface QueryResult {
    columns: string[];
    rows: any[];
    rowCount: number;
    executionTime: number;
}

export class SQLiteManager {
    private db: Database.Database | null = null;
    private currentDbPath: string | null = null;

    constructor(private context: vscode.ExtensionContext) {}

    public async openDatabase(dbPath?: string): Promise<boolean> {
        try {
            // Close existing connection
            if (this.db) {
                this.db.close();
                this.db = null;
            }

            // If no path provided, show file picker
            if (!dbPath) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'SQLite Database': ['db', 'sqlite', 'sqlite3', 'db3'],
                        'All Files': ['*']
                    },
                    title: 'Select SQLite Database'
                });

                if (!result || result.length === 0) {
                    return false;
                }

                dbPath = result[0].fsPath;
            }

            // Check if file exists
            if (!fs.existsSync(dbPath)) {
                vscode.window.showErrorMessage(`Database file not found: ${dbPath}`);
                return false;
            }

            // Open database
            this.db = new Database(dbPath);
            this.currentDbPath = dbPath;

            vscode.window.showInformationMessage(`Connected to: ${path.basename(dbPath)}`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to open database: ${errorMessage}`);
            return false;
        }
    }

    public async createDatabase(dbPath?: string): Promise<boolean> {
        try {
            if (!dbPath) {
                const result = await vscode.window.showSaveDialog({
                    filters: {
                        'SQLite Database': ['db', 'sqlite', 'sqlite3'],
                        'All Files': ['*']
                    },
                    title: 'Create SQLite Database'
                });

                if (!result) {
                    return false;
                }

                dbPath = result.fsPath;
            }

            // Create new database
            this.db = new Database(dbPath);
            this.currentDbPath = dbPath;

            vscode.window.showInformationMessage(`Created database: ${path.basename(dbPath)}`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to create database: ${errorMessage}`);
            return false;
        }
    }

    public closeDatabase(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.currentDbPath = null;
        }
    }

    public isConnected(): boolean {
        return this.db !== null;
    }

    public getCurrentDatabasePath(): string | null {
        return this.currentDbPath;
    }

    public getCurrentDatabaseName(): string | null {
        return this.currentDbPath ? path.basename(this.currentDbPath) : null;
    }

    public getTables(): SQLiteTable[] {
        if (!this.db) {
            throw new Error('No database connection');
        }

        const query = "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        return this.db.prepare(query).all() as SQLiteTable[];
    }

    public getTableColumns(tableName: string): SQLiteColumn[] {
        if (!this.db) {
            throw new Error('No database connection');
        }

        const query = `PRAGMA table_info('${tableName}')`;
        return this.db.prepare(query).all() as SQLiteColumn[];
    }

    public executeQuery(query: string): QueryResult {
        if (!this.db) {
            throw new Error('No database connection');
        }

        const startTime = Date.now();
        const trimmedQuery = query.trim().toLowerCase();

        try {
            if (trimmedQuery.startsWith('select') || trimmedQuery.startsWith('pragma')) {
                // Read query
                const stmt = this.db.prepare(query);
                const rows = stmt.all() as any[];
                const executionTime = Date.now() - startTime;

                const columns = rows.length > 0 && rows[0] ? Object.keys(rows[0]) : [];

                return {
                    columns,
                    rows,
                    rowCount: rows.length,
                    executionTime
                };
            } else {
                // Write query (INSERT, UPDATE, DELETE, CREATE, etc.)
                const stmt = this.db.prepare(query);
                const info = stmt.run();
                const executionTime = Date.now() - startTime;

                return {
                    columns: ['changes', 'lastInsertRowid'],
                    rows: [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }],
                    rowCount: info.changes,
                    executionTime
                };
            }
        } catch (error) {
            const executionTime = Date.now() - startTime;
            throw error;
        }
    }

    public getTableData(tableName: string, limit: number = 100, offset: number = 0): QueryResult {
        const query = `SELECT * FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`;
        return this.executeQuery(query);
    }

    public getRowCount(tableName: string): number {
        if (!this.db) {
            throw new Error('No database connection');
        }

        const query = `SELECT COUNT(*) as count FROM "${tableName}"`;
        const result = this.db.prepare(query).get() as { count: number };
        return result.count;
    }

    public dispose(): void {
        this.closeDatabase();
    }
}
