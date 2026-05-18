import {
    JSZipObjectLikeReadOnlyInterface,
    JSZipLikeReadOnlyInterface,
} from '../../../../dist-BeforeSC2/JSZipLikeReadOnlyInterface';
import {isBoolean, isPlainObject, isString} from 'lodash';
import type {LogWrapper} from "../../../../dist-BeforeSC2/ModLoadController";

export interface ZipFile {
    pathInZip: string;
    pathInSpecialFolder?: string;
    file?: JSZipObjectLikeReadOnlyInterface;
    isFile: boolean;
    isFolder: boolean;
    isInSpecialFolderPath: boolean;
    isImage?: boolean;
}

export function isZipFileObj(A: any): A is ZipFile {
    return isPlainObject(A) && isString(A.pathInZip) && isBoolean(A.isFile) && isBoolean(A.isFolder) && isBoolean(A.isInSpecialFolderPath);
}

export interface TraverseOptions {
    getFileRef?: boolean;
    skipFolder?: boolean;
    onImageFound?: (imageInfo: {
        pathInZip: string;
        pathInSpecialFolder?: string;
        file: JSZipObjectLikeReadOnlyInterface;
    }) => Promise<void>;
    progressCallback?: (progress: number, total: number) => Promise<void> | void;
}

export function isImageFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '');
}

export async function traverseZipFolder(
    zip: JSZipLikeReadOnlyInterface,
    specialFolderPath: string,
    _logger: LogWrapper,
    options: TraverseOptions = {},
): Promise<ZipFile[]> {
    const {
        getFileRef = false,
        skipFolder = false,
        onImageFound,
        progressCallback,
    } = options;

    const normalizedPath = specialFolderPath.endsWith('/') ? specialFolderPath : specialFolderPath + '/';
    const result: ZipFile[] = [];
    let processedFiles = 0;

    for (const [pathInZip, file] of Object.entries(zip.files)) {
        if (!pathInZip.startsWith(normalizedPath)) {
            continue;
        }
        if (skipFolder && file.dir) {
            continue;
        }

        const isImage = !file.dir && isImageFile(pathInZip);
        const zipFile: ZipFile = {
            pathInZip,
            pathInSpecialFolder: pathInZip.slice(normalizedPath.length),
            isFile: !file.dir,
            isFolder: file.dir,
            isInSpecialFolderPath: true,
            isImage,
        };

        if (getFileRef) {
            zipFile.file = file;
        }

        if (isImage && onImageFound) {
            await onImageFound({
                pathInZip,
                pathInSpecialFolder: zipFile.pathInSpecialFolder,
                file,
            });
            processedFiles++;
            if (progressCallback) {
                await progressCallback(processedFiles, processedFiles);
            }
        }

        result.push(zipFile);
    }

    return result;
}
