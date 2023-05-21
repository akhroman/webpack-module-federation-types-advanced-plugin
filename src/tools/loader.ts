import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { TLooseObject, TURLObject } from '../interfaces/Common';
import { Helper } from './helpers';

export class Loader {
    readonly parsedRemotes: Record<string, URL>;

    constructor(
        public remotes: TLooseObject,
        public remoteUrls: TLooseObject = {},
        public defaultPath: string,
        public loadTypesDir: string,
    ) {
        const entries = Object.entries(remoteUrls).reduce(
            (acc: TURLObject, [fileName, path]) => ({ ...acc, [fileName]: new URL(`${path}${fileName}.d.ts`) }),
            {},
        );
        this.parsedRemotes = Object.entries(remotes).reduce((acc: TURLObject, [fileName, path]) => {
            if (remoteUrls[fileName]) {
                return acc;
            }
            const normalPath = path.split('@')[1];
            const url = `${Loader.getDefaultPath(normalPath, defaultPath)}${fileName}.d.ts`;
            return { ...acc, [fileName]: new URL(url) };
        }, entries);
    }

    public async get() {
        const downloadPromise = Object.entries(this.parsedRemotes).reduce((acc: Promise<TLooseObject>[], [fileName, url]) => {
            return [...acc, this.downloadFile(url, fileName)];
        }, []);
        const resultPromise = await Promise.allSettled(downloadPromise);
        const successResult = resultPromise.reduce((acc: TLooseObject, promise) => {
            if (promise.status === 'rejected') {
                return acc;
            }
            return { ...acc, ...promise.value };
        }, {});
        const unSuccessResult = Object.keys(this.parsedRemotes).filter((elem) => !Object.keys(successResult).includes(elem));
        if (unSuccessResult.length > 0) {
            Helper.logger.error(`ERROR: Failed to load declare files for ${unSuccessResult.join(', ')}`);
        }
        Object.entries(successResult).forEach(([fileName, content]) => this.saveFile(fileName, content));
    }

    public static getDefaultPath(url: string, defaultTypesPath: string) {
        return path.join(new URL(url).origin, defaultTypesPath);
    }

    private async downloadFile(url: URL, fileName: string) {
        const get = url.protocol === 'https:' ? https.get : http.get;
        Helper.logger.info(`Start load header files for ${fileName}`);
        return new Promise<TLooseObject>((resolve, reject) => {
            get(url.href, (res) => {
                res.setEncoding('utf8');
                const content: string[] = [];
                res.on('data', (chunk) => content.push(chunk));
                res.on('end', () => resolve({ [fileName]: content.join() }));
                res.on('error', () => Helper.logger.error(`ERROR: Failed to load declare files from ${url.href}`));
            }).on('error', (err) => {
                Helper.logger.error(`ERROR: Failed to load declare files from ${url.href}`);
                reject(err);
            });
        });
    }

    private saveFile(fileName: string, content: string) {
        const outPath = path.join(this.loadTypesDir, `${fileName}.d.ts`);
        let isContentChanged = undefined;
        if (!fs.existsSync(this.loadTypesDir)) {
            try {
                fs.mkdirSync(this.loadTypesDir, { recursive: true });
            } catch {
                Helper.logger.error(`ERROR: Failed to create folder for loaded types`);
                Helper.logger.error(`The plugin is disabled`);
                process.exit(1);
            }
        }
        if (fs.existsSync(outPath)) {
            const currentContent = fs.readFileSync(outPath).toString();
            isContentChanged = currentContent !== content;
        }
        if (isContentChanged === false) {
            Helper.logger.log(`There are no changes for ${fileName}. Entry skipped`);
            return;
        }
        if (isContentChanged) {
            Helper.logger.log(`Update types for ${fileName}`);
        }
        fs.writeFileSync(outPath, content);
    }
}
