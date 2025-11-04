import * as vscode from 'vscode';
import { APIRequest } from './apiTester';

export interface Collection {
    id: string;
    name: string;
    description?: string;
    requests: APIRequest[];
    folders?: CollectionFolder[];
    createdAt: number;
    updatedAt: number;
}

export interface CollectionFolder {
    id: string;
    name: string;
    requests: APIRequest[];
}

export class CollectionsManager {
    private collections: Collection[] = [];
    private _onDidChangeCollections = new vscode.EventEmitter<void>();
    public readonly onDidChangeCollections = this._onDidChangeCollections.event;

    constructor(private context: vscode.ExtensionContext) {
        this.loadCollections();
    }

    private loadCollections() {
        const saved = this.context.globalState.get<Collection[]>('apiCollections', []);
        this.collections = saved;
    }

    private async saveCollections() {
        await this.context.globalState.update('apiCollections', this.collections);
        this._onDidChangeCollections.fire();
    }

    public async createCollection(name: string, description?: string): Promise<Collection> {
        const collection: Collection = {
            id: `col_${Date.now()}`,
            name,
            description,
            requests: [],
            folders: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.collections.push(collection);
        await this.saveCollections();
        return collection;
    }

    public async deleteCollection(id: string) {
        this.collections = this.collections.filter(c => c.id !== id);
        await this.saveCollections();
    }

    public async renameCollection(id: string, newName: string) {
        const collection = this.collections.find(c => c.id === id);
        if (collection) {
            collection.name = newName;
            collection.updatedAt = Date.now();
            await this.saveCollections();
        }
    }

    public async updateCollectionDescription(id: string, description: string) {
        const collection = this.collections.find(c => c.id === id);
        if (collection) {
            collection.description = description;
            collection.updatedAt = Date.now();
            await this.saveCollections();
        }
    }

    public async addRequestToCollection(collectionId: string, request: APIRequest, folderId?: string) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection) return;

        if (folderId) {
            const folder = collection.folders?.find(f => f.id === folderId);
            if (folder) {
                folder.requests.push(request);
            }
        } else {
            collection.requests.push(request);
        }

        collection.updatedAt = Date.now();
        await this.saveCollections();
    }

    public async removeRequestFromCollection(collectionId: string, requestId: string, folderId?: string) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection) return;

        if (folderId) {
            const folder = collection.folders?.find(f => f.id === folderId);
            if (folder) {
                folder.requests = folder.requests.filter(r => r.id !== requestId);
            }
        } else {
            collection.requests = collection.requests.filter(r => r.id !== requestId);
        }

        collection.updatedAt = Date.now();
        await this.saveCollections();
    }

    public async updateRequest(collectionId: string, requestId: string, updatedRequest: APIRequest, folderId?: string) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection) return;

        let requests = folderId
            ? collection.folders?.find(f => f.id === folderId)?.requests
            : collection.requests;

        if (requests) {
            const index = requests.findIndex(r => r.id === requestId);
            if (index !== -1) {
                requests[index] = updatedRequest;
                collection.updatedAt = Date.now();
                await this.saveCollections();
            }
        }
    }

    public async createFolder(collectionId: string, folderName: string) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection) return;

        if (!collection.folders) {
            collection.folders = [];
        }

        const folder: CollectionFolder = {
            id: `folder_${Date.now()}`,
            name: folderName,
            requests: []
        };

        collection.folders.push(folder);
        collection.updatedAt = Date.now();
        await this.saveCollections();
        return folder;
    }

    public async deleteFolder(collectionId: string, folderId: string) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection || !collection.folders) return;

        collection.folders = collection.folders.filter(f => f.id !== folderId);
        collection.updatedAt = Date.now();
        await this.saveCollections();
    }

    public async renameFolder(collectionId: string, folderId: string, newName: string) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection || !collection.folders) return;

        const folder = collection.folders.find(f => f.id === folderId);
        if (folder) {
            folder.name = newName;
            collection.updatedAt = Date.now();
            await this.saveCollections();
        }
    }

    public getCollections(): Collection[] {
        return this.collections;
    }

    public getCollection(id: string): Collection | undefined {
        return this.collections.find(c => c.id === id);
    }

    public getAllRequests(collectionId: string): APIRequest[] {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection) return [];

        const requests = [...collection.requests];

        if (collection.folders) {
            for (const folder of collection.folders) {
                requests.push(...folder.requests);
            }
        }

        return requests;
    }

    /**
     * Export collection to JSON format (Postman-compatible structure)
     */
    public exportCollection(collectionId: string): string {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection) return '';

        const exported = {
            info: {
                name: collection.name,
                description: collection.description,
                schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
            },
            item: [
                ...collection.requests.map(req => this.requestToPostmanFormat(req)),
                ...(collection.folders || []).map(folder => ({
                    name: folder.name,
                    item: folder.requests.map(req => this.requestToPostmanFormat(req))
                }))
            ]
        };

        return JSON.stringify(exported, null, 2);
    }

    private requestToPostmanFormat(request: APIRequest) {
        return {
            name: request.name,
            request: {
                method: request.method,
                header: Object.entries(request.headers || {}).map(([key, value]) => ({
                    key,
                    value,
                    type: "text"
                })),
                body: request.body ? {
                    mode: "raw",
                    raw: request.body
                } : undefined,
                url: {
                    raw: request.url,
                    protocol: new URL(request.url).protocol.replace(':', ''),
                    host: new URL(request.url).hostname.split('.'),
                    path: new URL(request.url).pathname.split('/').filter(p => p),
                    query: Array.from(new URL(request.url).searchParams.entries()).map(([key, value]) => ({
                        key,
                        value
                    }))
                }
            }
        };
    }

    /**
     * Import collection from JSON (Postman-compatible format)
     */
    public async importCollection(jsonContent: string): Promise<Collection | undefined> {
        try {
            const data = JSON.parse(jsonContent);

            const collection = await this.createCollection(
                data.info?.name || 'Imported Collection',
                data.info?.description
            );

            if (data.item && Array.isArray(data.item)) {
                for (const item of data.item) {
                    if (item.request) {
                        // It's a request
                        const request = this.postmanFormatToRequest(item);
                        await this.addRequestToCollection(collection.id, request);
                    } else if (item.item && Array.isArray(item.item)) {
                        // It's a folder
                        const folder = await this.createFolder(collection.id, item.name);
                        if (folder) {
                            for (const subItem of item.item) {
                                if (subItem.request) {
                                    const request = this.postmanFormatToRequest(subItem);
                                    await this.addRequestToCollection(collection.id, request, folder.id);
                                }
                            }
                        }
                    }
                }
            }

            return collection;
        } catch (error) {
            console.error('Failed to import collection:', error);
            return undefined;
        }
    }

    private postmanFormatToRequest(item: any): APIRequest {
        const request = item.request;

        const headers: { [key: string]: string } = {};
        if (request.header && Array.isArray(request.header)) {
            for (const header of request.header) {
                headers[header.key] = header.value;
            }
        }

        return {
            id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: item.name || 'Imported Request',
            method: request.method || 'GET',
            url: request.url?.raw || request.url || '',
            headers,
            body: request.body?.raw,
            timestamp: Date.now()
        };
    }

    /**
     * Duplicate a collection
     */
    public async duplicateCollection(collectionId: string): Promise<Collection | undefined> {
        const original = this.collections.find(c => c.id === collectionId);
        if (!original) return undefined;

        const duplicate = await this.createCollection(
            `${original.name} (Copy)`,
            original.description
        );

        // Copy requests
        for (const request of original.requests) {
            const newRequest = { ...request, id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` };
            await this.addRequestToCollection(duplicate.id, newRequest);
        }

        // Copy folders
        if (original.folders) {
            for (const folder of original.folders) {
                const newFolder = await this.createFolder(duplicate.id, folder.name);
                if (newFolder) {
                    for (const request of folder.requests) {
                        const newRequest = { ...request, id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` };
                        await this.addRequestToCollection(duplicate.id, newRequest, newFolder.id);
                    }
                }
            }
        }

        return duplicate;
    }
}
