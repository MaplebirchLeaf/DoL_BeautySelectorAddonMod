import type {LogWrapper} from "../../../dist-BeforeSC2/ModLoadController";
import type {AddonPluginHookPointEx} from "../../../dist-BeforeSC2/AddonPlugin";
import type {SC2DataManager} from "../../../dist-BeforeSC2/SC2DataManager";
import type {ModUtils} from "../../../dist-BeforeSC2/Utils";
import type {
    JSZipLikeReadOnlyInterface,
    JSZipObjectLikeReadOnlyInterface,
} from "../../../dist-BeforeSC2/JSZipLikeReadOnlyInterface";
import type {
    IModImgGetter,
    ModBootJson,
    ModInfo,
} from "../../../dist-BeforeSC2/ModLoader";
import type {ModZipReader} from "../../../dist-BeforeSC2/ModZipReader";
import {every, isArray, isFunction, isNil, isString} from 'lodash';
import {extname} from "./extname";
import JSON5 from 'json5';
import {
    BeautySelectorAddonParamsType0,
    BeautySelectorAddonParamsType1,
    BeautySelectorAddonParamsType2, BeautySelectorAddonParamsType2ATypeItem, BeautySelectorAddonParamsType2BTypeItem,
    BSModItem,
    ModImgEx,
    TypeOrderItem,
} from "./BeautySelectorAddonType";
import {BeautySelectorAddonInterface} from "./BeautySelectorAddonInterface";
import {traverseZipFolder, isImageFile} from "./utils/traverseZipFolder";
import type {
    ModSubUiAngularJsModeExportInterface
} from "../../ModSubUiAngularJs/dist-ts/ModSubUiAngularJsModeExportInterface";
import {StringTable} from "./GUI_StringTable/StringTable";
import {CachedFileList, ModImageStore} from "./ModImageStore";
import {CssReplacer} from "./CssReplacer";
import {NodeMutationObserver} from "./NodeMutationObserver";

export function imgWrapBase64Url(fileName: string, base64: string) {
    let ext = extname(fileName);
    if (ext.startsWith('.')) {
        ext = ext.substring(1);
    }
    // console.log('imgWrapBase64Url', [fileName, ext, base64]);
    return `data:image/${ext};base64,${base64}`;
}

export class BeautySelectorAddonImgGetterIndexedDB implements IModImgGetter {
    constructor(
        public modName: string,
        public modHashString: string,
        public type: string,
        public imgPath: string,
        public imageStore: ModImageStore,
        public logger: LogWrapper,
    ) {
    }

    invalid: boolean = false;

    async forceCache() {
        // No-op for IndexedDB version since data is already cached
        // this.imgCache = await this.getBase64Image();
    }

    async getBase64Image() {
        arguments.length > 0 && console.error('[BeautySelectorAddon] BeautySelectorAddonImgGetterIndexedDB getBase64Image() cannot have arguments.', arguments);
        if (this.invalid) {
            return undefined;
        }

        try {
            const imageData = await this.imageStore.getImage(this.modName, this.modHashString, this.type, this.imgPath);
            if (imageData) {
                return imageData;
            } else {
                this.invalid = true;
                console.error(`[BeautySelectorAddon] BeautySelectorAddonImgGetterIndexedDB getBase64Image() image not found: ${this.imgPath} in ${this.modName}`);
                this.logger.error(`[BeautySelectorAddon] BeautySelectorAddonImgGetterIndexedDB getBase64Image() image not found: ${this.imgPath} in ${this.modName}`);
                return undefined;
            }
        } catch (error) {
            this.invalid = true;
            console.error(`[BeautySelectorAddon] BeautySelectorAddonImgGetterIndexedDB getBase64Image() error: ${this.imgPath} in ${this.modName}`, error);
            this.logger.error(`[BeautySelectorAddon] BeautySelectorAddonImgGetterIndexedDB getBase64Image() error: ${this.imgPath} in ${this.modName}`);
            return undefined;
        }
    }

}

export function isParamsType0(a: any): a is BeautySelectorAddonParamsType0 {
    return a
        && (isString(a.type) || isNil(a.type))
        && isNil(a.imgFileList)
        && isNil(a.types)
        ;
}

export function isParamsType1(a: any): a is BeautySelectorAddonParamsType1 {
    return a
        && isString(a.type)
        && !isNil(a.imgFileList) && isArray(a.imgFileList) && every(a.imgFileList, isString)
        && isNil(a.types)
        ;
}

export function isParamsType2AItem(a: any): a is BeautySelectorAddonParamsType2ATypeItem {
    return a
        && isString(a.type)
        && isString(a.imgFileListFile)
        && isNil(a.imgDir)
        ;
}

export function isParamsType2BItem(a: any): a is BeautySelectorAddonParamsType2BTypeItem {
    return a
        && isString(a.type)
        && isString(a.imgDir)
        && isNil(a.imgFileListFile)
        ;
}

export function isParamsType2(a: any): a is BeautySelectorAddonParamsType2 {
    return a
        && isNil(a.type)
        && isNil(a.imgFileList)
        && isArray(a.types) && every(a.types, T => isParamsType2AItem(T) || isParamsType2BItem(T))
        ;
}

export function getDirFromPath(path: string) {
    if (path.endsWith('/') || path.endsWith('\\')) {
        // is dir
        return path;
    }
    const lastSlash1 = path.lastIndexOf('/');
    const lastSlash2 = path.lastIndexOf('\\');
    const lastSlash = Math.max(lastSlash1, lastSlash2);
    if (lastSlash === -1) {
        // only a file name
        return '';
    }
    return path.substring(0, lastSlash + 1);
}

export class BeautySelectorAddon implements AddonPluginHookPointEx, BeautySelectorAddonInterface {
    private logger: LogWrapper;

    constructor(
        public gSC2DataManager: SC2DataManager,
        public gModUtils: ModUtils,
    ) {
        this.logger = gModUtils.getLogger();
        this.gSC2DataManager.getAddonPluginManager().registerAddonPlugin(
            'BeautySelectorAddon',
            'BeautySelectorAddon',
            this,
        );
        this.ImageLoaderCompatibilityAddonPlugins();
        this.gSC2DataManager.getModLoadController().addLifeTimeCircleHook(
            'BeautySelectorAddon',
            {
                canLoadThisMod: this.canLoadThisMod.bind(this),
                ModLoaderLoadEnd: async () => {
                    await this.onModLoaderLoadEnd();
                    this.nodeMutationObserver.start();
                    await this.replaceStyleSheets();
                },
            }
        );
        this.IdbKeyValRef = this.gModUtils.getIdbKeyValRef();
        this.cachedFileList = new CachedFileList(this.gModUtils, this.logger);
        this.imageStore = new ModImageStore(this.gModUtils, this.logger);
        this.cssReplacer = new CssReplacer(window, gSC2DataManager, gModUtils);
        this.nodeMutationObserver = new NodeMutationObserver(this.imageGetter.bind(this), gModUtils);
        window.modImgLoaderHooker = this;

        const theName = this.gModUtils.getNowRunningModName();
        if (!theName) {
            console.error('[BeautySelectorAddon] init() (!theName).', [theName]);
            this.logger.error(`[BeautySelectorAddon] init() [${theName}].`);
            return;
        }
        const mod = this.gModUtils.getMod(theName);
        if (!mod) {
            console.error('[BeautySelectorAddon] init() (!mod). ', [theName]);
            this.logger.error(`[BeautySelectorAddon] init() (!mod). [${theName}].`);
            return;
        }
        console.log('[BeautySelectorAddon] register modRef done.', [theName]);
        this.logger.log(`[BeautySelectorAddon] register modRef done. [${theName}].`);
        mod.modRef = this;
        if (window.modLoaderGui_ModSubUiAngularJsService) {
            this.typeOrderSubUi = new TypeOrderSubUi(window.modLoaderGui_ModSubUiAngularJsService, this);
        }
    }

    protected cachedFileList: CachedFileList;
    protected imageStore: ModImageStore;
    protected cssReplacer: CssReplacer;
    protected nodeMutationObserver: NodeMutationObserver;
    protected typeOrderSubUi?: TypeOrderSubUi;
    protected imageStoreYieldCount = 0;
    protected sideHooker: {
        hookName: string;
        imageLoader: (
            src: string,
            layer: any,
            successCallback: (src: string, layer: any, img: HTMLImageElement) => void,
            errorCallback: (src: string, layer: any, event: any) => void,
        ) => Promise<boolean>;
        imageGetter: (src: string) => Promise<string | undefined>;
        checkImageExist?: (src: string) => boolean | undefined;
    }[] = [];

    protected ImageLoaderCompatibilityAddonPlugins() {
        const addonPluginManager = this.gSC2DataManager.getAddonPluginManager();
        const list: [string, string][] = [
            ['ImageLoaderHook', 'ImageLoaderAddon'],
            ['ImageLoaderHookCore', 'ImageLoaderAddon'],
            ['ModLoader DoL ImageLoaderHook', 'ImageLoaderAddon'],
            ['ImageLoaderHook2BeautySelectorAddon', 'ImageLoaderHook2BeautySelectorAddon'],
        ];
        for (const [modName, addonName] of list) addonPluginManager.registerAddonPlugin(modName, addonName, this);
    }

    protected async waitImageStoreTurn() {
        this.imageStoreYieldCount++;
        if ((this.imageStoreYieldCount % 16) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    public addSideHooker(hooker: BeautySelectorAddon['sideHooker'][number]) {
        if (isString(hooker?.hookName) && isFunction(hooker.imageLoader) && isFunction(hooker.imageGetter)) {
            console.log('[BeautySelectorAddon] addSideHooker() ok', [hooker]);
            this.logger.log(`[BeautySelectorAddon] addSideHooker() ok: hookName[${hooker.hookName}]`);
            this.sideHooker.push(hooker);
            return;
        }
        console.error('[BeautySelectorAddon] addSideHooker() failed. invalid hook.', [hooker]);
        this.logger.error(`[BeautySelectorAddon] addSideHooker() failed. invalid hook.`);
    }

    public removeModFromImgLookupTable(modNameList: string[]) {
        const modNameListSet = new Set(modNameList);
        this.typeOrder = this.typeOrder.filter(T => !modNameListSet.has(T.modRef.name));
        this.typeOrderUsed = this.typeOrderUsed?.filter(T => !modNameListSet.has(T.modRef.name));
    }

    protected getImageMimeType(imagePath: string) {
        const ext = imagePath.split('.').pop()?.toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
        if (ext === 'gif') return 'image/gif';
        if (ext === 'webp') return 'image/webp';
        if (ext === 'svg') return 'image/svg+xml';
        if (ext === 'bmp') return 'image/bmp';
        return 'image/png';
    }

    protected async storeZipImageToIndexDB(
        streaming: Awaited<ReturnType<ModImageStore['initStreamingStorage']>>,
        imagePath: string,
        realPath: string,
        imageFile: JSZipObjectLikeReadOnlyInterface,
    ) {
        const base64Data = await imageFile.async('base64');
        const imageData = `data:${this.getImageMimeType(realPath)};base64,${base64Data}`;
        await streaming.storeImage(imagePath, realPath, imageData);
        await this.waitImageStoreTurn();
    }

    async onModLoaderLoadEnd() {
        if (!this.typeOrderUsed) this.typeOrderUsed = this.typeOrder;
        await this.loadSavedOrder();
        await this.typeOrderSubUi?.init();
        await this.cachedFileList.removeNotExistMod(this.registerModNameSet);
        await this.imageStore.removeNotExistModImages(this.registerModNameSet);
        this.cachedFileList.close();
        // this.imageStore.close();
        console.log('[BeautySelectorAddon] all ok');
        this.logger.log('[BeautySelectorAddon] all ok');
    }

    private table: Map<string, BSModItem> = new Map<string, BSModItem>();

    private typeOrder: TypeOrderItem[] = [];

    getTypeOrder() {
        return this.typeOrder;
    }

    // can re-order this list
    typeOrderUsed?: TypeOrderItem[];

    getUsingTypeOrder(): undefined | { type: string, modName: string }[] {
        return this.typeOrderUsed?.map(T => {
            return {
                type: T.type,
                modName: T.modRef.name,
            };
        });
    }

    protected registerModNameSet: Set<string> = new Set<string>();

    type0ModNameList: string[] = [];

    async canLoadThisMod(bootJson: ModBootJson, _zip: JSZipLikeReadOnlyInterface): Promise<boolean> {
        const oldImageLoaderAddonList = bootJson.addonPlugin?.filter(T => this.ImageLoaderAddonModName(T.modName));
        if (oldImageLoaderAddonList?.length) {
            bootJson.addonPlugin = bootJson.addonPlugin?.filter(T => !this.ImageLoaderAddonModName(T.modName)) || [];
            if (!bootJson.addonPlugin.find(T => T.modName === 'BeautySelectorAddon' && T.addonName === 'BeautySelectorAddon')) {
                bootJson.addonPlugin.push({
                    modName: 'BeautySelectorAddon',
                    addonName: 'BeautySelectorAddon',
                    modVersion: '^2.9.0',
                    params: oldImageLoaderAddonList[0].params || {},
                });
            }
        }
        if (bootJson.dependenceInfo?.length) {
            bootJson.dependenceInfo = bootJson.dependenceInfo.filter(T => !this.ImageLoaderAddonModName(T.modName));
        }
        return true;
    }

    async registerMod(addonName: string, mod: ModInfo, modZip: ModZipReader) {
        let ad = mod.bootJson.addonPlugin?.find(T => T.modName === 'BeautySelectorAddon' && T.addonName === 'BeautySelectorAddon');
        ad ??= mod.bootJson.addonPlugin?.find(T => this.ImageLoaderAddonModName(T.modName));
        if (!ad) {
            console.error(`[BeautySelectorAddon] registerMod: cannot find addonPlugin in bootJson`, [addonName, mod.name, mod, modZip]);
            this.logger.error(`[BeautySelectorAddon] registerMod: cannot find addonPlugin in bootJson [${mod.name}]`);
            return;
        }
        const modName = mod.name;
        const modHash = modZip.modZipReaderHash;
        this.registerModNameSet.add(modName);
        await this.cachedFileList.removeChangedModFileByHash(modName, modHash.toString());
        await this.imageStore.removeChangedModImages(modName, modHash.toString());

        if (isParamsType0(ad.params)) {
            // this is converted from ImageLoaderHook 2 BeautySelectorAddon

            const params: BeautySelectorAddonParamsType0 = ad.params;
            const type = params.type;

            const typeName = type ? type : ('converted-' + modName);
            if (this.table.has(typeName)) {
                console.warn(`[BeautySelectorAddon] registerMod: Type0 typeName already exist`, [addonName, mod.name, mod, modZip, typeName, this.table.get(typeName)]);
                this.logger.warn(`[BeautySelectorAddon] registerMod: Type0 typeName[${typeName}] already exist in [${this.table.get(typeName)!.name}]. this type will not be add.`);
                return;
            }

            const oImg = mod.imgs;
            const imgList = new Map<string, ModImgEx>(
                oImg.map(T => {
                    return [T.path, {
                        path: T.path,
                        realPath: T.path,
                        getter: T.getter,
                    }];
                }),
            );
            // clean it
            mod.imgs = [];

            const BS = {
                name: modName,
                mod: mod,
                modZip: modZip,
                type: [typeName],
                params: ad.params,
                typeImg: new Map<string, Map<string, ModImgEx>>([[typeName, imgList]]),
            };
            this.table.set(typeName, BS);
            this.typeOrder.push({
                type: typeName,
                modRef: BS,
                imgListRef: imgList,
            });

            this.type0ModNameList.push(modName);

            console.log(`[BeautySelectorAddon] converted Mod ok.`, [addonName, mod.name, mod, modZip, typeName]);
            this.logger.log(`[BeautySelectorAddon] converted Mod ok. [${mod.name}]`);
        } else if (isParamsType1(ad.params)) {
            const params: BeautySelectorAddonParamsType1 = ad.params;
            const type = params.type;
            if (this.table.has(type)) {
                console.warn(`[BeautySelectorAddon] registerMod: type already exist`, [addonName, mod.name, mod, modZip, type, this.table.get(type)]);
                this.logger.warn(`[BeautySelectorAddon] registerMod: type[${type}] already exist in [${this.table.get(type)!.name}]. this type will not be add.`);
                return;
            }

            // Check if images are already stored in IndexedDB
            const hasStoredImages = await this.imageStore.hasStoredImages(modName, modHash.toString(), type);

            if (!hasStoredImages) {
                // Initialize streaming storage for efficient memory usage
                const streaming = await this.imageStore.initStreamingStorage(modName, modHash.toString(), type);

                try {
                    // Process images one by one to minimize memory usage
                    for (const imagePath of params.imgFileList) {
                        if (isImageFile(imagePath)) {
                            const imageFile = modZip.zip.file(imagePath);
                            if (imageFile) {
                                try {
                                    await this.storeZipImageToIndexDB(streaming, imagePath, imagePath, imageFile);
                                } catch (error) {
                                    console.warn(`[BeautySelectorAddon] Failed to process image: ${imagePath}`, error);
                                }
                            }
                        }
                    }

                    // Finalize streaming storage
                    await streaming.finalize();
                    console.log('[BeautySelectorAddon] streamed images to IndexedDB (Type1)', [modName, type, streaming.imagePaths.length]);

                } catch (error) {
                    console.error('[BeautySelectorAddon] Error during streaming image processing (Type1)', error);
                    throw error;
                }
            }

            // Get image paths from IndexedDB
            const imagePaths = await this.imageStore.getImagePaths(modName, modHash.toString(), type);

            const imgList = new Map<string, ModImgEx>();
            if (imagePaths) {
                for (const imagePath of imagePaths) {
                    imgList.set(imagePath, {
                        path: imagePath,
                        realPath: imagePath, // Not needed for IndexedDB version
                        getter: new BeautySelectorAddonImgGetterIndexedDB(modName, modHash.toString(), type, imagePath, this.imageStore, this.logger),
                    });
                }
            }

            const BS = {
                name: addonName,
                mod: mod,
                modZip: modZip,
                type: [type],
                params: ad.params,
                typeImg: new Map<string, Map<string, ModImgEx>>([[type, imgList]]),
            };
            this.table.set(type, BS);
            this.typeOrder.push({
                type: type,
                modRef: BS,
                imgListRef: imgList,
            });
        } else if (isParamsType2(ad.params)) {
            const params: BeautySelectorAddonParamsType2 = ad.params;
            if ((new Set(params.types.map(T => T.type))).size !== params.types.length) {
                console.error(`[BeautySelectorAddon] registerMod: have duplicate type`, [addonName, mod.name, mod, modZip]);
                this.logger.error(`[BeautySelectorAddon] registerMod: have duplicate type in mod[${mod.name}]. invalid mod config`);
                return;
            }
            const BS: BSModItem = {
                name: mod.name,
                mod: mod,
                modZip: modZip,
                type: [],
                params: ad.params,
                typeImg: new Map<string, Map<string, ModImgEx>>(),
            };
            for (const L of params.types) {
                const type = L.type;
                if (this.table.has(type)) {
                    console.warn(`[BeautySelectorAddon] registerMod: type already exist`, [addonName, mod.name, mod, modZip, type, L, this.table.get(type)]);
                    this.logger.warn(`[BeautySelectorAddon] registerMod: type[${type}] already exist in [${this.table.get(type)!.name}]`);
                    continue;
                }
                const existType = this.typeOrder.find(T => T.type === type);
                if (existType) {
                    console.error(`[BeautySelectorAddon] registerMod: type already exist.`, [addonName, mod.name, mod, modZip, type, L, existType]);
                    this.logger.error(`[BeautySelectorAddon] registerMod: modName[${mod.name}] type[${type}] already exist in otherModeName[${existType.modRef.name}]. this type will not be add.`);
                    continue;
                }
                if (isParamsType2AItem(L)) {
                    // Check if images are already stored in IndexedDB
                    const hasStoredImages = await this.imageStore.hasStoredImages(modName, modHash.toString(), type);

                    if (!hasStoredImages) {
                        const imgFileListFile = await modZip.zip.file(L.imgFileListFile)?.async('string');
                        if (!imgFileListFile) {
                            console.error(`[BeautySelectorAddon] registerMod: imgFileListFile not found.`, [addonName, mod.name, mod, modZip, type, L]);
                            this.logger.error(`[BeautySelectorAddon] registerMod: modName[${mod.name}] type[${type}] imgFileListFile[${L.imgFileListFile}] not found. this type will not be add.`);
                            continue;
                        }
                        let imgFileList: string[] = [];
                        try {
                            imgFileList = JSON5.parse(imgFileListFile);
                            if (!(isArray(imgFileList) && every(imgFileList, isString))) {
                                console.error(`[BeautySelectorAddon] registerMod: imgFileListFile is not a string array.`, [addonName, mod.name, mod, modZip, type, L]);
                                this.logger.error(`[BeautySelectorAddon] registerMod: modName[${mod.name}] type[${type}] imgFileListFile is not a string array. this type will not be add.`);
                                continue;
                            }
                        } catch (e: Error | any) {
                            console.error(`[BeautySelectorAddon] registerMod: imgFileListFile is not a valid json.`, [addonName, mod.name, mod, modZip, type, L]);
                            this.logger.error(`[BeautySelectorAddon] registerMod: modName[${mod.name}] type[${type}] imgFileListFile is not a valid json. this type will not be add.`);
                            continue;
                        }

                        // Initialize streaming storage for efficient memory usage
                        const streaming = await this.imageStore.initStreamingStorage(modName, modHash.toString(), type);

                        try {
                            // Process images one by one to minimize memory usage
                            const dirP = getDirFromPath(L.imgFileListFile);

                            for (const imagePath of imgFileList) {
                                const realPath = dirP + imagePath;
                                if (isImageFile(realPath)) {
                                    const imageFile = modZip.zip.file(realPath);
                                    if (imageFile) {
                                        try {
                                            await this.storeZipImageToIndexDB(streaming, imagePath, realPath, imageFile);
                                        } catch (error) {
                                            console.warn(`[BeautySelectorAddon] Failed to process image: ${realPath}`, error);
                                        }
                                    }
                                }
                            }

                            // Finalize streaming storage
                            await streaming.finalize();
                            console.log('[BeautySelectorAddon] streamed images to IndexedDB (Type2A)', [modName, type, streaming.imagePaths.length]);

                        } catch (error) {
                            console.error('[BeautySelectorAddon] Error during streaming image processing (Type2A)', error);
                            throw error;
                        }
                    }

                    // Get image paths from IndexedDB
                    const imagePaths = await this.imageStore.getImagePaths(modName, modHash.toString(), type);

                    const imgList = new Map<string, ModImgEx>();
                    if (imagePaths) {
                        for (const imagePath of imagePaths) {
                            imgList.set(imagePath, {
                                path: imagePath,
                                realPath: imagePath, // Not needed for IndexedDB version
                                getter: new BeautySelectorAddonImgGetterIndexedDB(modName, modHash.toString(), type, imagePath, this.imageStore, this.logger),
                            });
                        }
                    }

                    BS.typeImg.set(type, imgList);
                    BS.type.push(type);

                    this.typeOrder.push({
                        type: type,
                        modRef: BS,
                        imgListRef: imgList,
                    });
                    this.table.set(type, BS);
                } else if (isParamsType2BItem(L)) {
                    // Check if images are already stored in IndexedDB
                    const hasStoredImages = await this.imageStore.hasStoredImages(modName, modHash.toString(), type);

                    if (!hasStoredImages) {
                        // Initialize streaming storage for this mod type
                        const streaming = await this.imageStore.initStreamingStorage(modName, modHash.toString(), type);

                        try {
                            // Process images with streaming approach to minimize memory usage
                            const fileList = await traverseZipFolder(modZip.zip, L.imgDir, this.logger, {
                                progressPercentStep: 10,
                                onImageFound: async (imageInfo) => {
                                    try {
                                        await this.storeZipImageToIndexDB(streaming, imageInfo.pathInSpecialFolder!, imageInfo.pathInZip, imageInfo.file);
                                    } catch (error) {
                                        console.warn(`[BeautySelectorAddon] Failed to process image: ${imageInfo.pathInZip}`, error);
                                    }
                                },
                                progressCallback: async (processedCount, totalCount) => {
                                    const percent = totalCount > 0 ? Math.floor((processedCount / totalCount) * 100) : 100;
                                    this.logger.log(`[BeautySelectorAddon] Cache file to IndexDB [${modName}] ...... [${processedCount}/${totalCount}] ${percent}%`);
                                    console.log(`[BeautySelectorAddon] Cache file to IndexDB [${processedCount}/${totalCount}] ${percent}%`, [modName, modHash, type]);
                                },
                            });

                            console.log('[BeautySelectorAddon] fileList from streaming traverseZipFolder', [modName, modHash, type, fileList.length]);
                            this.logger.log(`[BeautySelectorAddon] fileList from streaming traverseZipFolder [${modName}] type[${type}] count[${fileList.length}]`);


                            // Finalize the streaming storage
                            await streaming.finalize();

                            // Also cache file list for compatibility
                            await this.cachedFileList.writeCachedFileList(modName, modHash.toString(), type, fileList.filter(T => T.isFile));
                        } catch (error) {
                            console.error('[BeautySelectorAddon] Error during streaming image processing', error);
                            throw error;
                        }
                    }

                    // Get image paths from IndexedDB
                    const imagePaths = await this.imageStore.getImagePaths(modName, modHash.toString(), type);

                    const imgList = new Map<string, ModImgEx>();
                    if (imagePaths) {
                        for (const imagePath of imagePaths) {
                            imgList.set(imagePath, {
                                path: imagePath,
                                realPath: imagePath, // Not needed for IndexedDB version
                                getter: new BeautySelectorAddonImgGetterIndexedDB(modName, modHash.toString(), type, imagePath, this.imageStore, this.logger),
                            });
                        }
                    }

                    BS.typeImg.set(type, imgList);
                    BS.type.push(type);

                    this.typeOrder.push({
                        type: type,
                        modRef: BS,
                        imgListRef: imgList,
                    });
                    this.table.set(type, BS);
                } else {
                    // never go here
                    throw new Error(`[BeautySelectorAddon] registerMod: invalid type. [${addonName}] [${mod.name}] [${type}]. never go there.`);
                }
            }
        } else {
            console.error(`[BeautySelectorAddon] registerMod: invalid params`, [addonName, mod.name, mod, modZip]);
            this.logger.error(`[BeautySelectorAddon] registerMod: invalid params [${mod.name}]`);
            return;
        }
    }

    async imageLoader(
        src: string,
        layer: any,
        successCallback: (src: string, layer: any, img: HTMLImageElement) => void,
        errorCallback: (src: string, layer: any, event: any) => void,
    ) {
        const imgString = await this.imageGetter(src);
        // console.log('[BeautySelectorAddon] imgLoaderHooker', [src, n]);
        if (imgString) {
            try {
                // this may throw error
                const image = new Image();
                image.onload = () => {
                    successCallback(src, layer, image);
                };
                image.onerror = (event) => {
                    console.error('[BeautySelectorAddon] imageLoader replace error', [src, event]);
                    this.logger.error(`[BeautySelectorAddon] imageLoader replace error: src[${src}]`);
                    errorCallback(src, layer, event);
                };
                image.src = imgString;
                // console.log('[BeautySelectorAddon] loadImage replace', [n.modName, src, image, n.imgData]);
                return true;
            } catch (e: Error | any) {
                console.error('[BeautySelectorAddon] imageLoader replace error', [src, e]);
                this.logger.error(`[BeautySelectorAddon] imageLoader replace error: src[${src}] e[${e?.message ? e.message : e}]`);
                return false;
            }
        } else {
            for (const hooker of this.sideHooker) {
                try {
                    const r = await hooker.imageLoader(src, layer, successCallback, errorCallback);
                    if (r) {
                        return true;
                    }
                } catch (e: Error | any) {
                    console.error('[BeautySelectorAddon] imageLoader sideHooker error', [src, hooker, e]);
                    this.logger.error(`[BeautySelectorAddon] imageLoader sideHooker error: src[${src}] hook[${hooker.hookName}] ${e?.message ? e.message : e}`);
                }
            }
            return false;
        }
    }

    errorCount = 0;

    async imageGetter(
        src: string,
    ) {
        src = this.normalizePath(src);

        if (!this.typeOrderUsed) {
            this.typeOrderUsed = this.typeOrder;
        }

        if (this.typeOrderUsed.length === 0) {
            // ignore
            return undefined;
        }

        // always running on fallback mode
        for (const type of this.typeOrderUsed) {
            const n = type.imgListRef?.get(src);
            if (n) {
                try {
                    // this may throw error
                    return await n.getter.getBase64Image();
                } catch (e: Error | any) {
                    console.error('[BeautySelectorAddon] imageGetter error', [src, type, e]);
                    this.logger.error(`[BeautySelectorAddon] imageGetter error: src[${src}] type[${type}] e[${e?.message ? e.message : e}]`);
                    return undefined;
                }
            }
        }
        // ignore ?
        for (const hooker of this.sideHooker) {
            try {
                const r = await hooker.imageGetter(src);
                if (r) {
                    return r;
                }
            } catch (e: Error | any) {
                console.error('[BeautySelectorAddon] imageGetter sideHooker error', [src, hooker, e]);
                this.logger.error(`[BeautySelectorAddon] imageGetter sideHooker error: src[${src}] hook[${hooker.hookName}] ${e?.message ? e.message : e}`);
            }
        }
        return undefined;
    }

    protected ImageLoaderAddonModName(modName: string) {
        return modName === 'ImageLoaderHook' || modName === 'ImageLoaderHookCore' || modName === 'ModLoader DoL ImageLoaderHook' || modName === 'ImageLoaderHook2BeautySelectorAddon';
    }

    async replaceStyleSheets() {
        await this.cssReplacer.replaceStyleSheets();
    }

    async replaceAllImageInHtmlElement(content: HTMLElement) {
        const imgList = Array.from(content.querySelectorAll('img'));
        await Promise.all(imgList.map(async (img) => this.nodeMutationObserver.processNodeTag(img, 'src')));
    }

    checkImageExist(src: string) {
        src = this.normalizePath(src);

        if (!this.typeOrderUsed) this.typeOrderUsed = this.typeOrder;

        if (this.typeOrderUsed.length === 0) {
            // ignore
            return false;
        }

        // always running on fallback mode
        for (const type of this.typeOrderUsed) {
            const n = type.imgListRef?.get(src);
            if (n) {
                try {
                    // this may throw error
                    const c = n.getter.invalid;
                    if (!c) {
                        return true;
                    }
                } catch (e: Error | any) {
                    console.error('[BeautySelectorAddon] imageGetter error', [src, type, e]);
                    this.logger.error(`[BeautySelectorAddon] imageGetter error: src[${src}] type[${type}] e[${e?.message ? e.message : e}]`);
                    // skip, maybe exist but a error happened .
                    return undefined;
                }
            }
        }
        // ignore ?
        let maybeExist = false;
        for (const hooker of this.sideHooker) {
            try {
                if (hooker.checkImageExist) {
                    const c = hooker.checkImageExist(src);
                    if (c === true) {
                        return true;
                    } else if (c === undefined) {
                        maybeExist = true;
                    }
                }
            } catch (e: Error | any) {
                console.error('[BeautySelectorAddon] checkImageExist sideHooker error', [src, hooker, e]);
                this.logger.error(`[BeautySelectorAddon] checkImageExist sideHooker error: src[${src}] hook[${hooker.hookName}] ${e?.message ? e.message : e}`);
            }
        }
        if (maybeExist) {
            return undefined;
        }
        return false;
    }


    init() {
        this.gSC2DataManager.getHtmlTagSrcHook().addCheckExistHook('BeautySelectorAddon', (mlSrc: string) => {
            return this.checkImageExist(mlSrc);
        });
        this.gSC2DataManager.getHtmlTagSrcHook().addHook('BeautySelectorAddon', async (el: HTMLImageElement | HTMLElement, mlSrc: string, field: string) => {
            const img = await this.imageGetter(mlSrc);
            if (img) {
                el.setAttribute(field, img);
                return true;
            }
            return false;
        });
        this.gSC2DataManager.getHtmlTagSrcHook().addReturnModeHook('BeautySelectorAddonReturnModeHooker', async (mlSrc: string) => {
            const img = await this.imageGetter(mlSrc);
            return [!!img, img || mlSrc];
        });

    }

    normalizePath(path: string): string {
        if (!path) return path;
        const segments = path.split('/').filter(segment => segment && segment !== '.');
        const normalized: string[] = [];

        for (const segment of segments) {
            if (segment === '..') {
                normalized.pop();
            } else {
                normalized.push(segment);
            }
        }

        return normalized.join('/');
    }

    async iniCustomStore() {
        if (!this.customStore) {
            const loaderKeyConfig = this.gModUtils.getModLoader().getLoaderKeyConfig();
            this.BeautySelectorAddon_dbName = loaderKeyConfig.getLoaderKey(this.BeautySelectorAddon_dbName, this.BeautySelectorAddon_dbName);
            this.BeautySelectorAddon_storeName = loaderKeyConfig.getLoaderKey(this.BeautySelectorAddon_storeName, this.BeautySelectorAddon_storeName);
            this.BeautySelectorAddon_OrderSaveKey = loaderKeyConfig.getLoaderKey(this.BeautySelectorAddon_OrderSaveKey, this.BeautySelectorAddon_OrderSaveKey);
            this.customStore = this.IdbKeyValRef.createStore(this.BeautySelectorAddon_dbName, this.BeautySelectorAddon_storeName);
        }
    }

    async loadSavedOrder() {
        await this.iniCustomStore();
        const listFile = await this.IdbKeyValRef.keyval_get(this.BeautySelectorAddon_OrderSaveKey, this.customStore);
        if (!listFile) {
            return undefined;
        }
        let list: string[];
        try {
            list = JSON5.parse(listFile);
        } catch (e) {
            console.error(e);
            return undefined;
        }
        if (!(isArray(list) && list.every(isString))) {
            return undefined;
        }
        const nn = new Map(this.typeOrder.map(T => [T.type, T]));
        if (list.every(T => nn.has(T))) {
            this.typeOrderUsed = list.map(T => nn.get(T)!);
            console.log('[BeautySelectorAddon] loadSavedOrder: ok.', [list]);
            this.logger.log(`[BeautySelectorAddon] loadSavedOrder: ok.`);
        } else {
            const nt = list.filter(T => !nn.has(T));
            console.log('[BeautySelectorAddon] loadSavedOrder: some type not found. reset.', [list, nt]);
            await this.saveOrder(this.typeOrder.map(T => T.type));
            this.typeOrderUsed = this.typeOrder;
        }
    }

    async saveOrder(list: string[]) {
        await this.iniCustomStore();
        if (!(isArray(list) && list.every(isString))) {
            // never go there
            throw new Error(`[BeautySelectorAddon] saveOrder: invalid list`);
        }
        await this.IdbKeyValRef.keyval_set(this.BeautySelectorAddon_OrderSaveKey, JSON.stringify(list), this.customStore);
    }

    BeautySelectorAddon_dbName: string = 'BeautySelectorAddon';
    BeautySelectorAddon_storeName: string = 'BeautySelectorAddon';
    BeautySelectorAddon_OrderSaveKey = 'BeautySelectorAddon_OrderSaveKey';

    // customStore?: UseStore;
    customStore?: ReturnType<ReturnType<ModUtils['getIdbKeyValRef']>['createStore']>;
    IdbKeyValRef: ReturnType<ModUtils['getIdbKeyValRef']>;
}

export class TypeOrderSubUi {
    constructor(
        public modSubUiAngularJsService: typeof window['modLoaderGui_ModSubUiAngularJsService'],
        public beautySelectorAddon: BeautySelectorAddon,
    ) {
    }

    async init() {
        this.modSubUiAngularJsService.addLifeTimeCallback('BeautySelectorAddon-TypeOrderSubUi', {
            whenCreate: this.whenCreate.bind(this),
        });
    }

    async whenCreate(Ref: ModSubUiAngularJsModeExportInterface) {

        const typeAllList = this.beautySelectorAddon.getTypeOrder();
        const typeAllSet = new Map<string, TypeOrderItem>(typeAllList.map(T => [T.type, T]));
        const typeEnabledList = this.beautySelectorAddon.typeOrderUsed || [];
        const typeDisabledList = typeAllList.filter(T => !typeEnabledList?.find(T2 => T2.type === T.type));
        Ref.addComponentModGuiConfig({
            selector: 'enable-order-component',
            data: {
                listEnabled: typeEnabledList.map(T => {
                    return {
                        key: T.type,
                        str: `[${T.modRef.name}] ${T.type}`,
                        selected: false,
                    };
                }),
                listDisabled: typeDisabledList.map(T => {
                    return {
                        key: T.type,
                        str: `[${T.modRef.name}] ${T.type}`,
                        selected: false,
                    };
                }),
                onChange: async (
                    _action: any,
                    listEnabled: {
                        key: string | number,
                        str: string,
                        selected: boolean,
                    }[],
                    _listDisabled: {
                        key: string | number,
                        str: string,
                        selected: boolean,
                    }[],
                    _selectedKeyEnabled: string | number,
                    _selectedKeyDisabled: string | number,
                ) => {
                    try {
                        // console.log('onChange', [action, listEnabled, listDisabled, selectedKeyEnabled, selectedKeyDisabled]);
                        this.beautySelectorAddon.typeOrderUsed = listEnabled.map(T => typeAllSet.get(T.key as string)).filter((T): T is TypeOrderItem => !!T);
                        // const enabledSet = new Set(this.beautySelectorAddon.typeOrderUsed.map(T => T.type));
                        await this.beautySelectorAddon.saveOrder(this.beautySelectorAddon.typeOrderUsed.map(T => T.type));
                    } catch (e) {
                        console.error('[BeautySelectorAddon] onChange error', [e]);
                    }
                },
                noHrSplit: true,
                buttonClass: 'btn btn-sm btn-secondary',
                text: {
                    MoveEnabledSelectedItemUp: StringTable.MoveEnabledSelectedItemUp,
                    MoveEnabledSelectedItemDown: StringTable.MoveEnabledSelectedItemDown,
                    EnableSelectedItem: StringTable.EnableSelectedItem,
                    DisableSelectedItem: StringTable.DisableSelectedItem,
                    MoveDisabledSelectedItemUp: StringTable.MoveDisabledSelectedItemUp,
                    MoveDisabledSelectedItemDown: StringTable.MoveDisabledSelectedItemDown,
                    title: StringTable.TypeGuiTitle,
                },
            },
        });
    }

}
