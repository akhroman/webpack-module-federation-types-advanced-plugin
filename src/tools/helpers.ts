import { Compiler } from 'webpack';
import fs from 'fs';
import path from 'path';
import { TLogger } from '../interfaces/Common';

let loggerInstance: TLogger | Console;

export class Helper {
    private static isUrl(url: string) {
        try {
            return Boolean(new URL(url));
        } catch (e) {
            return false;
        }
    }

    static checkUrl(urls: string | string[]): boolean {
        if (Array.isArray(urls)) {
            return urls.every((url) => this.isUrl(url));
        }
        return this.isUrl(urls);
    }

    static get logger() {
        return loggerInstance || console;
    }

    static set logger(log: TLogger | Console) {
        loggerInstance = log;
    }

    static checkLogLevel(compiler: Compiler): boolean {
        return ['verbose', 'log'].includes(compiler.options.infrastructureLogging.level!);
    }

    static normalizePath(fileName: string) {
        if (path.sep !== path.posix.sep) {
            return fileName.split(path.sep).join(path.posix.sep);
        }
        return fileName;
    }

    static getDirFiles(path: string) {
        if (!fs.existsSync(path)) {
            return [];
        }
        return fs.readdirSync(path).map((file) => `${path}/${file}`);
    }
}
