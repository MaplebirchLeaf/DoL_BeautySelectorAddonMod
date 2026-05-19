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
    progressPercentStep?: number;
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
        progressPercentStep = 10,
        onImageFound,
        progressCallback,
    } = options;

    const normalizedPath = specialFolderPath.endsWith('/') ? specialFolderPath : specialFolderPath + '/';
    const entries = Object.entries(zip.files).filter(([pathInZip, file]) => {
        if (!pathInZip.startsWith(normalizedPath)) return false;
        if (skipFolder && file.dir) return false;
        return true;
    });

    const totalImages = entries.reduce((count, [pathInZip, file]) => {
        return count + (!file.dir && isImageFile(pathInZip) ? 1 : 0);
    }, 0);

    const result: ZipFile[] = [];

    let processedImages = 0;
    let nextReportPercent = Math.max(1, progressPercentStep);

    const reportProgress = async (force = false) => {
        if (!progressCallback || totalImages === 0) return;
        const currentPercent = Math.floor((processedImages / totalImages) * 100);
        if (force || currentPercent >= nextReportPercent || processedImages === totalImages ) {
            await progressCallback(processedImages, totalImages);
            while (nextReportPercent <= currentPercent) nextReportPercent += Math.max(1, progressPercentStep);
        }
    };

    for (const [pathInZip, file] of entries) {
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

            processedImages++;
            await reportProgress(processedImages === totalImages);
        }

        result.push(zipFile);
    }

    return result;
}
