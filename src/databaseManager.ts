import * as vscode from 'vscode';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { Pool as PostgresPool, PoolConfig } from 'pg';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

export type DatabaseType = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb';

export interface ConnectionConfig {
    id: string;
    name: string;
    type: DatabaseType;
    // SQLite
    filePath?: string;
    // PostgreSQL/MySQL
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    ssl?: boolean;
}

export interface DatabaseTable {
    name: string;
    schema?: string;
    type: 'table' | 'view';
    rowCount?: number;
}

export interface DatabaseColumn {
    name: string;
    type: string;
    nullable: boolean;
    default: any;
    isPrimary: boolean;
    isUnique: boolean;
}

export interface QueryResult {
    columns: string[];
    rows: any[];
    rowCount: number;
    executionTime: number;
    affectedRows?: number;
}

export interface DatabaseConnection {
    id: string;
    config: ConnectionConfig;
    type: DatabaseType;
    isConnected: boolean;
}

export class DatabaseManager {
    private connections: Map<string, any> = new Map();
    private sqlJs: any;

    constructor(private context: vscode.ExtensionContext) {}

    async initialize(): Promise<void> {
        // Initialize sql.js
        const wasmPath = path.join(this.context.extensionPath, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
        this.sqlJs = await initSqlJs({
            locateFile: () => wasmPath
        });
    }

    // ===== CONNECTION MANAGEMENT =====

    async connect(config: ConnectionConfig): Promise<boolean> {
        try {
            switch (config.type) {
                case 'sqlite':
                    return await this.connectSQLite(config);
                case 'postgresql':
                    return await this.connectPostgreSQL(config);
                case 'mysql':
                case 'mariadb':
                    return await this.connectMySQL(config);
                default:
                    throw new Error(`Unsupported database type: ${config.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to connect: ${errorMessage}`);
            return false;
        }
    }

    private async connectSQLite(config: ConnectionConfig): Promise<boolean> {
        if (!config.filePath) {
            throw new Error('SQLite file path is required');
        }

        if (!fs.existsSync(config.filePath)) {
            throw new Error(`Database file not found: ${config.filePath}`);
        }

        const buffer = fs.readFileSync(config.filePath);
        const db = new this.sqlJs.Database(buffer);

        this.connections.set(config.id, {
            type: 'sqlite',
            db,
            filePath: config.filePath
        });

        return true;
    }

    private async connectPostgreSQL(config: ConnectionConfig): Promise<boolean> {
        const poolConfig: PoolConfig = {
            host: config.host,
            port: config.port || 5432,
            database: config.database,
            user: config.username,
            password: config.password,
            ssl: config.ssl ? { rejectUnauthorized: false } : false,
            max: 10,
            idleTimeoutMillis: 30000
        };

        const pool = new PostgresPool(poolConfig);

        // Test connection
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();

        this.connections.set(config.id, {
            type: 'postgresql',
            pool
        });

        return true;
    }

    private async connectMySQL(config: ConnectionConfig): Promise<boolean> {
        const connection = await mysql.createConnection({
            host: config.host,
            port: config.port || 3306,
            database: config.database,
            user: config.username,
            password: config.password,
            ssl: config.ssl ? {} : undefined
        });

        // Test connection
        await connection.ping();

        this.connections.set(config.id, {
            type: config.type,
            connection
        });

        return true;
    }

    async disconnect(connectionId: string): Promise<void> {
        const conn = this.connections.get(connectionId);
        if (!conn) return;

        try {
            switch (conn.type) {
                case 'sqlite':
                    conn.db.close();
                    break;
                case 'postgresql':
                    await conn.pool.end();
                    break;
                case 'mysql':
                case 'mariadb':
                    await conn.connection.end();
                    break;
            }
        } catch (error) {
            console.error('Error disconnecting:', error);
        }

        this.connections.delete(connectionId);
    }

    isConnected(connectionId: string): boolean {
        return this.connections.has(connectionId);
    }

    getConnection(connectionId: string): any {
        return this.connections.get(connectionId);
    }

    // ===== DATABASE OPERATIONS =====

    async getTables(connectionId: string): Promise<DatabaseTable[]> {
        const conn = this.connections.get(connectionId);
        if (!conn) throw new Error('Not connected');

        switch (conn.type) {
            case 'sqlite':
                return this.getTablesSQLite(conn.db);
            case 'postgresql':
                return await this.getTablesPostgreSQL(conn.pool);
            case 'mysql':
            case 'mariadb':
                return await this.getTablesMySQL(conn.connection);
            default:
                return [];
        }
    }

    private getTablesSQLite(db: SqlJsDatabase): DatabaseTable[] {
        const result = db.exec(`
            SELECT name, type
            FROM sqlite_master
            WHERE type IN ('table', 'view')
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `);

        if (!result || result.length === 0) return [];

        const tables: DatabaseTable[] = [];
        result[0].values.forEach(row => {
            tables.push({
                name: row[0] as string,
                type: row[1] === 'table' ? 'table' : 'view'
            });
        });

        return tables;
    }

    private async getTablesPostgreSQL(pool: PostgresPool): Promise<DatabaseTable[]> {
        const result = await pool.query(`
            SELECT
                schemaname as schema,
                tablename as name,
                'table' as type
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            UNION ALL
            SELECT
                schemaname as schema,
                viewname as name,
                'view' as type
            FROM pg_views
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY name
        `);

        return result.rows.map(row => ({
            name: row.name,
            schema: row.schema,
            type: row.type
        }));
    }

    private async getTablesMySQL(connection: any): Promise<DatabaseTable[]> {
        const [rows] = await connection.query('SHOW FULL TABLES');

        return rows.map((row: any) => {
            const tableName = Object.values(row)[0] as string;
            const tableType = Object.values(row)[1] as string;

            return {
                name: tableName,
                type: tableType === 'BASE TABLE' ? 'table' : 'view'
            };
        });
    }

    async getTableColumns(connectionId: string, tableName: string, schema?: string): Promise<DatabaseColumn[]> {
        const conn = this.connections.get(connectionId);
        if (!conn) throw new Error('Not connected');

        switch (conn.type) {
            case 'sqlite':
                return this.getTableColumnsSQLite(conn.db, tableName);
            case 'postgresql':
                return await this.getTableColumnsPostgreSQL(conn.pool, tableName, schema);
            case 'mysql':
            case 'mariadb':
                return await this.getTableColumnsMySQL(conn.connection, tableName);
            default:
                return [];
        }
    }

    private getTableColumnsSQLite(db: SqlJsDatabase, tableName: string): DatabaseColumn[] {
        const result = db.exec(`PRAGMA table_info('${tableName}')`);

        if (!result || result.length === 0) return [];

        const columns: DatabaseColumn[] = [];
        result[0].values.forEach(row => {
            columns.push({
                name: row[1] as string,
                type: row[2] as string,
                nullable: row[3] === 0,
                default: row[4],
                isPrimary: row[5] === 1,
                isUnique: false
            });
        });

        return columns;
    }

    private async getTableColumnsPostgreSQL(pool: PostgresPool, tableName: string, schema: string = 'public'): Promise<DatabaseColumn[]> {
        const result = await pool.query(`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                (SELECT COUNT(*) FROM information_schema.key_column_usage
                 WHERE table_schema = $1 AND table_name = $2 AND column_name = c.column_name
                 AND constraint_name LIKE '%_pkey') > 0 as is_primary,
                (SELECT COUNT(*) FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                 WHERE tc.constraint_type = 'UNIQUE'
                 AND kcu.table_schema = $1 AND kcu.table_name = $2
                 AND kcu.column_name = c.column_name) > 0 as is_unique
            FROM information_schema.columns c
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
        `, [schema, tableName]);

        return result.rows.map(row => ({
            name: row.column_name,
            type: row.data_type,
            nullable: row.is_nullable === 'YES',
            default: row.column_default,
            isPrimary: row.is_primary,
            isUnique: row.is_unique
        }));
    }

    private async getTableColumnsMySQL(connection: any, tableName: string): Promise<DatabaseColumn[]> {
        const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);

        return rows.map((row: any) => ({
            name: row.Field,
            type: row.Type,
            nullable: row.Null === 'YES',
            default: row.Default,
            isPrimary: row.Key === 'PRI',
            isUnique: row.Key === 'UNI'
        }));
    }

    async executeQuery(connectionId: string, query: string): Promise<QueryResult> {
        const conn = this.connections.get(connectionId);
        if (!conn) throw new Error('Not connected');

        const startTime = Date.now();

        try {
            let result: QueryResult;

            switch (conn.type) {
                case 'sqlite':
                    result = this.executeQuerySQLite(conn.db, query);
                    break;
                case 'postgresql':
                    result = await this.executeQueryPostgreSQL(conn.pool, query);
                    break;
                case 'mysql':
                case 'mariadb':
                    result = await this.executeQueryMySQL(conn.connection, query);
                    break;
                default:
                    throw new Error('Unsupported database type');
            }

            result.executionTime = Date.now() - startTime;
            return result;
        } catch (error) {
            throw error;
        }
    }

    private executeQuerySQLite(db: SqlJsDatabase, query: string): QueryResult {
        const trimmedQuery = query.trim().toLowerCase();

        if (trimmedQuery.startsWith('select') || trimmedQuery.startsWith('pragma')) {
            const result = db.exec(query);

            if (!result || result.length === 0) {
                return {
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    executionTime: 0
                };
            }

            const columns = result[0].columns;
            const rows = result[0].values.map(values => {
                const row: any = {};
                columns.forEach((col, i) => {
                    row[col] = values[i];
                });
                return row;
            });

            return {
                columns,
                rows,
                rowCount: rows.length,
                executionTime: 0
            };
        } else {
            db.run(query);

            // Save changes to file
            const conn = this.connections.get('current'); // We'll need to pass this properly
            if (conn && conn.filePath) {
                const data = db.export();
                fs.writeFileSync(conn.filePath, data);
            }

            return {
                columns: ['result'],
                rows: [{ result: 'Query executed successfully' }],
                rowCount: 0,
                executionTime: 0,
                affectedRows: 0
            };
        }
    }

    private async executeQueryPostgreSQL(pool: PostgresPool, query: string): Promise<QueryResult> {
        const result = await pool.query(query);

        if (result.rows && result.rows.length > 0) {
            return {
                columns: Object.keys(result.rows[0]),
                rows: result.rows,
                rowCount: result.rows.length,
                executionTime: 0,
                affectedRows: result.rowCount ?? undefined
            };
        }

        return {
            columns: [],
            rows: [],
            rowCount: 0,
            executionTime: 0,
            affectedRows: result.rowCount ?? undefined
        };
    }

    private async executeQueryMySQL(connection: any, query: string): Promise<QueryResult> {
        const [rows, fields] = await connection.query(query);

        if (Array.isArray(rows) && rows.length > 0) {
            return {
                columns: Object.keys(rows[0]),
                rows: rows,
                rowCount: rows.length,
                executionTime: 0,
                affectedRows: rows.length
            };
        }

        return {
            columns: [],
            rows: [],
            rowCount: 0,
            executionTime: 0,
            affectedRows: (rows as any).affectedRows || 0
        };
    }

    async getTableData(connectionId: string, tableName: string, limit: number = 100, offset: number = 0): Promise<QueryResult> {
        const conn = this.connections.get(connectionId);
        if (!conn) throw new Error('Not connected');

        let query: string;

        switch (conn.type) {
            case 'sqlite':
                query = `SELECT * FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`;
                break;
            case 'postgresql':
                query = `SELECT * FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`;
                break;
            case 'mysql':
            case 'mariadb':
                query = `SELECT * FROM \`${tableName}\` LIMIT ${limit} OFFSET ${offset}`;
                break;
            default:
                throw new Error('Unsupported database type');
        }

        return this.executeQuery(connectionId, query);
    }

    async getRowCount(connectionId: string, tableName: string): Promise<number> {
        const conn = this.connections.get(connectionId);
        if (!conn) throw new Error('Not connected');

        let query: string;

        switch (conn.type) {
            case 'sqlite':
                query = `SELECT COUNT(*) as count FROM "${tableName}"`;
                break;
            case 'postgresql':
                query = `SELECT COUNT(*) as count FROM "${tableName}"`;
                break;
            case 'mysql':
            case 'mariadb':
                query = `SELECT COUNT(*) as count FROM \`${tableName}\``;
                break;
            default:
                return 0;
        }

        const result = await this.executeQuery(connectionId, query);
        const count = result.rows[0]?.count;
        return typeof count === 'number' ? count : 0;
    }

    dispose(): void {
        for (const [id] of this.connections) {
            this.disconnect(id).catch(console.error);
        }
        this.connections.clear();
    }
}
