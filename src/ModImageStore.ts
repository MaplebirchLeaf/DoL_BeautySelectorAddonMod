import type {LogWrapper} from "../../../dist-BeforeSC2/ModLoadController";
import type {ModUtils} from "../../../dist-BeforeSC2/Utils";
import {every, isArray} from 'lodash';
import {isZipFileObj, ZipFile} from "./utils/traverseZipFolder";
import {openDB as idb_openDB, IDBPDatabase, IDBPTransaction, StoreNames, DBSchema} from 'idb';

export interface CachedFileListDbSchema extends DBSchema {
    cachedFileList: {
        value: {
            modName: string,
            modHashString: string,
            type: string,
            fileList: ZipFile[],
            hashKey: string, // `${modName}_${modHashString}_${type}`
        },
        key: string,
        indexes: {
            'by-hashKey': string,
            'by-modName': string,
            'by-modHashString': string,
            'by-type': string,
            'by-imagePath': string,
            'by-modName-modHashString': [string, string],
            'by-modName-type': [string, string],
            'by-modName-modHashString-type': [string, string, string],
        },
    },
}

export interface ModImageStoreDbSchema extends DBSchema {
    imageStore: {
        value: {
            modName: string,
            modHashString: string,
            type: string,
            imagePath: string,
            realPath: string,
            imageData: string,
            imageKey: string, // `${modName}_${modHashString}_${type}_${imagePath}`
        },
        key: string,
        indexes: {
            'by-modName': string,
            'by-modHashString': string,
            'by-type': string,
            'by-imagePath': string,
            'by-modName-modHashString': [string, string],
            'by-modName-type': [string, string],
            'by-modName-modHashString-type': [string, string, string],
        },
    },
    imageMetadata: {
        value: {
            modName: string,
            modHashString: string,
            type: string,
            imagePaths: string[],
            metaKey: string, // `${modName}_${modHashString}_${type}`
        },
        key: string,
        indexes: {
            'by-modName': string,
            'by-modHashString': string,
            'by-type': string,
            'by-modName-modHashString': [string, string],
            'by-modName-type': [string, string],
            'by-modName-modHashString-type': [string, string, string],
        },
    },
}

type ImageStoreRecord = ModImageStoreDbSchema['imageStore']['value'];

export class CachedFileList {

    constructor(
        public gModUtils: ModUtils,
        public logger: LogWrapper,
    ) {
    }

    protected dbRef?: IDBPDatabase<CachedFileListDbSchema>;

    protected isInit = false;
    protected isClose = false;

    protected async iniCacheCustomStore() {
        if (this.isClose) {
            console.error('[BeautySelectorAddon] iniCacheCustomStore: already close');
            throw new Error('[BeautySelectorAddon] iniCacheCustomStore: already close');
        }
        if (!this.isInit) {
            const loaderKeyConfig = this.gModUtils.getModLoader().getLoaderKeyConfig();
            this.BeautySelectorAddon_dbNameCacheFileList = loaderKeyConfig.getLoaderKey(this.BeautySelectorAddon_dbNameCacheFileList, this.BeautySelectorAddon_dbNameCacheFileList);

            this.dbRef = await idb_openDB<CachedFileListDbSchema>(
                this.BeautySelectorAddon_dbNameCacheFileList,
                1,
                {
                    upgrade: (database: IDBPDatabase<CachedFileListDbSchema>) => {
                        const cachedFileListStorage = database.createObjectStore('cachedFileList', {
                            keyPath: 'hashKey',
                        });
                        cachedFileListStorage.createIndex('by-modName', 'modName');
                        cachedFileListStorage.createIndex('by-modHashString', 'modHashString');
                        cachedFileListStorage.createIndex('by-type', 'type');
                        cachedFileListStorage.createIndex('by-modName-modHashString', ['modName', 'modHashString']);
                        cachedFileListStorage.createIndex('by-modName-type', ['modName', 'type']);
                        cachedFileListStorage.createIndex('by-modName-modHashString-type', ['modName', 'modHashString', 'type']);
                    },
                },
            );
        }
        this.isInit = true;
    }

    BeautySelectorAddon_dbNameCacheFileList: string = 'BeautySelectorAddon_dbNameCacheFileList';

    async getCachedFileList(modName: string, modHashString: string, type: string): Promise<ZipFile[] | undefined> {
        try {
            await this.iniCacheCustomStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] getCachedFileList error', [e]);
            throw e;
        }
        // const store = this.dbRef!.transaction('cachedFileList').objectStore('cachedFileList');
        // await store.index('by-modName-modHashString-type').get([modName, modHashString, type]);
        const r = await this.dbRef!.getFromIndex('cachedFileList', 'by-modName-modHashString-type', [modName, modHashString, type]);

        if (!r) {
            return undefined;
        }

        try {
            const fileList = r.fileList;
            if (isArray(fileList) && every(fileList, isZipFileObj)) {
                return fileList;
            }
            // invalid , remove it
            await this.dbRef!.delete('cachedFileList', r.hashKey);
            return undefined;
        } catch (e) {
            // if error , remove it
            await this.dbRef!.delete('cachedFileList', r.hashKey);
            console.error('[BeautySelectorAddon] getCachedFileList error', [r.fileList, e]);
            return undefined;
        }
    }

    async writeCachedFileList(modName: string, modHashString: string, type: string, fileList: ZipFile[]) {
        try {
            await this.iniCacheCustomStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] writeCachedFileList error', [e]);
            throw e;
        }
        const hashKey = `${modName}_${modHashString}_${type}`;

        const tans = this.dbRef!.transaction('cachedFileList', 'readwrite');
        try {
            const os = tans.objectStore('cachedFileList');

            // check exist
            const cc = await os.get(hashKey);
            if (cc) {
                await tans.done;
                return false;
            }

            const value = {
                modName: modName,
                modHashString: modHashString,
                type: type,
                fileList: fileList,
                hashKey: hashKey,
            } satisfies CachedFileListDbSchema['cachedFileList']['value'];

            await os.put(value);
            console.log('[BeautySelectorAddon] writeCachedFileList ok', [value]);
            this.logger.log(`[BeautySelectorAddon] writeCachedFileList ok for mod [${modName}], type [${type}], files count [${fileList.length}]`);
        } finally {
            await tans.done;
        }
        return true;

    }

    async removeChangedModFileByHash(modName: string, modHashString: string) {
        try {
            await this.iniCacheCustomStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] removeChangedModFileByHash error', [e]);
            throw e;
        }
        // remove the item that same mod name but different hash
        const tans = this.dbRef!.transaction('cachedFileList', 'readwrite');
        try {
            const os = tans.objectStore('cachedFileList');
            for await (const cursor of os.index('by-modName').iterate(modName)) {
                const c = cursor.value;
                if (c.modHashString !== modHashString) {
                    console.log('[BeautySelectorAddon] removeChangedModFileByHash', [c]);
                    await cursor.delete();
                }
            }
        } finally {
            await tans.done;
        }
    }

    async removeNotExistMod(modNameSet: Set<string>) {
        try {
            await this.iniCacheCustomStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] removeNotExistMod error', [e]);
            throw e;
        }
        const tans = this.dbRef!.transaction('cachedFileList', 'readwrite');
        try {
            for await (const cursor of tans.store) {
                const m = cursor.value;
                if (!modNameSet.has(m.modName)) {
                    console.log('[BeautySelectorAddon] removeNotExistMod', [m]);
                    await cursor.delete();
                }
            }
        } finally {
            await tans.done;
        }
    }

    close() {
        this.dbRef?.close();
        this.isInit = false;
        this.isClose = true;
        this.dbRef = undefined;
    }

}

export class ModImageStore {

    constructor(
        public gModUtils: ModUtils,
        public logger: LogWrapper,
    ) {
    }

    protected dbRef?: IDBPDatabase<ModImageStoreDbSchema>;

    protected isInit = false;
    protected isClose = false;

    protected async iniImageStore() {
        if (this.isClose) {
            console.error('[BeautySelectorAddon] iniImageStore: already close');
            throw new Error('[BeautySelectorAddon] iniImageStore: already close');
        }
        if (!this.isInit) {
            const loaderKeyConfig = this.gModUtils.getModLoader().getLoaderKeyConfig();
            this.BeautySelectorAddon_dbNameImageStore = loaderKeyConfig.getLoaderKey(this.BeautySelectorAddon_dbNameImageStore, this.BeautySelectorAddon_dbNameImageStore);

            this.dbRef = await idb_openDB<ModImageStoreDbSchema>(
                this.BeautySelectorAddon_dbNameImageStore,
                1,
                {
                    upgrade: (database: IDBPDatabase<ModImageStoreDbSchema>, oldVersion: number, _newVersion: number | null, transaction: IDBPTransaction<ModImageStoreDbSchema, StoreNames<ModImageStoreDbSchema>[], "versionchange">) => {
                        if (!database.objectStoreNames.contains('imageStore')) {
                            const imageStorage = database.createObjectStore('imageStore', {
                                keyPath: 'imageKey',
                            });
                            imageStorage.createIndex('by-modName', 'modName');
                            imageStorage.createIndex('by-modHashString', 'modHashString');
                            imageStorage.createIndex('by-type', 'type');
                            imageStorage.createIndex('by-imagePath', 'imagePath');
                            imageStorage.createIndex('by-modName-modHashString', ['modName', 'modHashString']);
                            imageStorage.createIndex('by-modName-type', ['modName', 'type']);
                            imageStorage.createIndex('by-modName-modHashString-type', ['modName', 'modHashString', 'type']);
                        }

                        if (!database.objectStoreNames.contains('imageMetadata')) {
                            const metadataStorage = database.createObjectStore('imageMetadata', {
                                keyPath: 'metaKey',
                            });
                            metadataStorage.createIndex('by-modName', 'modName');
                            metadataStorage.createIndex('by-modHashString', 'modHashString');
                            metadataStorage.createIndex('by-type', 'type');
                            metadataStorage.createIndex('by-modName-modHashString', ['modName', 'modHashString']);
                            metadataStorage.createIndex('by-modName-type', ['modName', 'type']);
                            metadataStorage.createIndex('by-modName-modHashString-type', ['modName', 'modHashString', 'type']);
                        }

                        if (oldVersion > 0 && oldVersion < 2) {
                            transaction.objectStore('imageStore').clear();
                            transaction.objectStore('imageMetadata').clear();
                        }
                    },
                },
            );
        }
        this.isInit = true;
    }

    BeautySelectorAddon_dbNameImageStore: string = 'BeautySelectorAddon_dbNameImageStore';

    protected ImageStoreBatchSize() {
        const navigatorInfo = window.navigator as Navigator & { deviceMemory?: number; };
        const deviceMemory = navigatorInfo.deviceMemory || 4;
        const hardwareConcurrency = navigatorInfo.hardwareConcurrency || 4;
        const userAgent = navigatorInfo.userAgent || '';
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
        if (deviceMemory <= 2 || hardwareConcurrency <= 2) return 1;
        if (deviceMemory <= 4 || hardwareConcurrency <= 4) return isMobile ? 2 : 4;
        if (deviceMemory >= 8 && hardwareConcurrency >= 8) return isMobile ? 8 : 24;
        return isMobile ? 4 : 12;
    }

    /**
     * Check if images for a mod are already stored
     */
    async hasStoredImages(modName: string, modHashString: string, type: string): Promise<boolean> {
        try {
            await this.iniImageStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] hasStoredImages error', [e]);
            throw e;
        }
        const metaKey = `${modName}_${modHashString}_${type}`;
        const metadata = await this.dbRef!.get('imageMetadata', metaKey);
        return !!metadata;
    }

    /**
     * Initialize streaming storage for a mod type
     */
    async initStreamingStorage(modName: string, modHashString: string, type: string): Promise<{
        imagePaths: string[];
        storeImage: (imagePath: string, realPath: string, imageData: string) => Promise<void>;
        finalize: () => Promise<void>;
    }> {
        try {
            await this.iniImageStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] initStreamingStorage error', [e]);
            throw e;
        }

        const metaKey = `${modName}_${modHashString}_${type}`;

        // Check if already exists
        const existingMeta = await this.dbRef!.get('imageMetadata', metaKey);
        if (existingMeta) {
            throw new Error(`Images already stored for ${modName} ${type}`);
        }

        const imagePaths: string[] = [];
        const pendingRecords: ImageStoreRecord[] = [];
        const batchSize = this.ImageStoreBatchSize();

        const flush = async () => {
            if (pendingRecords.length === 0) return;
            const records = pendingRecords.splice(0, pendingRecords.length);
            const transaction = this.dbRef!.transaction('imageStore', 'readwrite');
            try {
                const store = transaction.objectStore('imageStore');
                for (const imageRecord of records) await store.put(imageRecord);
            } finally {
                await transaction.done;
            }
            imagePaths.push(...records.map(T => T.imagePath));
        };

        const storeImage = async (imagePath: string, realPath: string, imageData: string) => {
            const imageKey = `${modName}_${modHashString}_${type}_${imagePath}`;
            const imageRecord: ImageStoreRecord = {
                modName,
                modHashString,
                type,
                imagePath,
                realPath,
                imageData,
                imageKey,
            };

            pendingRecords.push(imageRecord);
            if (pendingRecords.length >= batchSize) await flush();
        };

        const finalize = async () => {
            await flush();
            const metadataRecord = {
                modName,
                modHashString,
                type,
                imagePaths,
                metaKey,
            };
            await this.dbRef!.put('imageMetadata', metadataRecord);
            console.log('[BeautySelectorAddon] Streamed images for mod', [modName, type, imagePaths.length]);
            this.logger.log(`[BeautySelectorAddon] Streamed images for mod [${modName}], type [${type}], count [${imagePaths.length}]`);
        };

        return {imagePaths, storeImage, finalize};
    }

    /**
     * Get image data by path
     */
    async getImage(modName: string, modHashString: string, type: string, imagePath: string): Promise<string | undefined> {
        try {
            await this.iniImageStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] getImage error', [e]);
            throw e;
        }

        const imageKey = `${modName}_${modHashString}_${type}_${imagePath}`;
        const imageRecord = await this.dbRef!.get('imageStore', imageKey);
        return imageRecord?.imageData;
    }

    /**
     * Get image paths for a mod type
     */
    async getImagePaths(modName: string, modHashString: string, type: string): Promise<string[] | undefined> {
        try {
            await this.iniImageStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] getImagePaths error', [e]);
            throw e;
        }

        const metaKey = `${modName}_${modHashString}_${type}`;
        const metadata = await this.dbRef!.get('imageMetadata', metaKey);
        return metadata?.imagePaths;
    }

    /**
     * Remove all images for a specific mod hash (when mod changes)
     */
    async removeChangedModImages(modName: string, modHashString: string): Promise<void> {
        try {
            await this.iniImageStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] removeChangedModImages error', [e]);
            throw e;
        }

        const transaction = this.dbRef!.transaction(['imageStore', 'imageMetadata'], 'readwrite');

        try {
            const imageStore = transaction.objectStore('imageStore');
            const metadataStore = transaction.objectStore('imageMetadata');

            // Remove images with same mod name but different hash
            for await (const cursor of imageStore.index('by-modName').iterate(modName)) {
                const image = cursor.value;
                if (image.modHashString !== modHashString) {
                    console.log('[BeautySelectorAddon] removeChangedModImages image', [image.imageKey]);
                    await cursor.delete();
                }
            }

            // Remove metadata with same mod name but different hash
            for await (const cursor of metadataStore.index('by-modName').iterate(modName)) {
                const meta = cursor.value;
                if (meta.modHashString !== modHashString) {
                    console.log('[BeautySelectorAddon] removeChangedModImages metadata', [meta.metaKey]);
                    await cursor.delete();
                }
            }
        } finally {
            await transaction.done;
        }
    }

    /**
     * Remove images for mods that no longer exist
     */
    async removeNotExistModImages(modNameSet: Set<string>): Promise<void> {
        try {
            await this.iniImageStore();
        } catch (e) {
            console.error('[BeautySelectorAddon] removeNotExistModImages error', [e]);
            throw e;
        }

        const transaction = this.dbRef!.transaction(['imageStore', 'imageMetadata'], 'readwrite');

        try {
            // Remove images for non-existent mods
            for await (const cursor of transaction.objectStore('imageStore')) {
                const image = cursor.value;
                if (!modNameSet.has(image.modName)) {
                    // console.log('[BeautySelectorAddon] removeNotExistModImages image', [image.imageKey]);
                    await cursor.delete();
                }
            }

            // Remove metadata for non-existent mods
            for await (const cursor of transaction.objectStore('imageMetadata')) {
                const meta = cursor.value;
                if (!modNameSet.has(meta.modName)) {
                    console.log('[BeautySelectorAddon] removeNotExistModImages metadata', [meta.metaKey]);
                    await cursor.delete();
                }
            }
        } finally {
            await transaction.done;
        }
    }

    close() {
        // this.dbRef?.close();
        // this.isInit = false;
        // this.isClose = true;
        // this.dbRef = undefined;
    }

}
