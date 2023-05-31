import { WebpackPluginInstance, Compiler as WebpackCompiler, Compilation, sources } from 'webpack';
import { EDefaultConst } from './enums';
import { Helper } from './tools/helpers';
import { TLooseObject } from './interfaces/Common';
import { IModuleFederationTypesAdvancedPluginOption, IPluginValidationLog, TModuleFederationOptions } from './interfaces/Plugin';
import { Compiler } from './tools/compiler';
import { Loader } from './tools/loader';

export class ModuleFederationTypesAdvancedPlugin implements WebpackPluginInstance {
    readonly PLUGIN_NAME: string;
    readonly remoteUrls?: TLooseObject;
    readonly rootDir: string;
    readonly emitedFileDir: string;
    readonly globalTypesDir: string;
    readonly loadTypesDir: string;
    readonly downloadTimeout: number;
    readonly isTypeGenDisabled: boolean;
    readonly isDownloadDisabled: boolean;
    readonly isOnceDownload: boolean;
    readonly tsConfigPath: string;
    readonly sslVerify: boolean;

    continuouslySync?: boolean;
    isAlreadyCompiled: boolean = false;
    isAlreadyDownloaded: boolean = false;
    compileInterval?: NodeJS.Timer;

    constructor({
        remoteUrls,
        rootDir = EDefaultConst.RootDir,
        emitedFileDir = EDefaultConst.EmitedTypesDir,
        globalTypesDir = EDefaultConst.GlobalTypesDir,
        loadTypesDir = EDefaultConst.LoadTypesDir,
        downloadTimeout = EDefaultConst.DownloadTimeout,
        isDownloadDisabled,
        isTypeGenDisabled,
        isOnceDownload,
        tsConfigPath = EDefaultConst.TSConfigFile,
        continuouslySync,
        sslVerify = false,
    }: IModuleFederationTypesAdvancedPluginOption = {}) {
        this.PLUGIN_NAME = this.constructor.name;
        this.remoteUrls = remoteUrls;
        this.rootDir = rootDir;
        this.emitedFileDir = emitedFileDir;
        this.globalTypesDir = globalTypesDir;
        this.loadTypesDir = loadTypesDir;
        this.downloadTimeout = downloadTimeout;
        this.isTypeGenDisabled = !!isTypeGenDisabled;
        this.isDownloadDisabled = !!isDownloadDisabled;
        this.isOnceDownload = !!isOnceDownload;
        this.tsConfigPath = tsConfigPath;
        this.continuouslySync = continuouslySync;
        this.sslVerify = sslVerify;
    }

    async apply(compiler: WebpackCompiler): Promise<void> {
        const pluginName = this.constructor.name;

        Helper.logger = compiler.getInfrastructureLogger(pluginName);
        this.continuouslySync =
            this.continuouslySync !== undefined ? this.continuouslySync : compiler.options.mode === 'development';

        const validate = this.checkInputs();

        for (const log of validate) {
            Helper.logger[log.type](log.message);
            if (log.exit) {
                Helper.logger.error('The plugin is disabled');
                return;
            }
        }

        const federationPlugin = compiler.options.plugins
            .filter((plugin) => plugin.constructor.name === 'ModuleFederationPlugin')
            .reduce(
                (acc, plugin) => {
                    const option: TModuleFederationOptions = (plugin as unknown as any)._options;
                    if (!option?.name) {
                        return { ...acc, withMissing: true };
                    }
                    return { ...acc, options: [...acc.options, option] };
                },
                { withMissing: false, options: [] as TModuleFederationOptions[] },
            );

        const { withMissing, options } = federationPlugin;

        if (!options.length) {
            Helper.logger.error('ERROR: ModuleFederationPlugin not found');
            Helper.logger.error('The plugin is disabled');
            return;
        }

        if (withMissing) {
            Helper.logger.warn('WARNING: Some ModuleFederationPlugins are ignored because the "name" property is omitted.');
        }

        if (options.some((option) => option.exposes) && !this.isTypeGenDisabled) {
            compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
                compilation.hooks.processAssets.tap(
                    {
                        name: pluginName,
                        stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
                    },
                    (_assets) => {
                        if (this.continuouslySync) {
                            Helper.logger.info('Compiling declare files on thisCompilation event');
                            Helper.logger.info(`Downloading declare files every ${this.downloadTimeout} ms`);
                            if (
                                (this.remoteUrls || options.some((option) => option.remotes)) &&
                                !this.isDownloadDisabled &&
                                !this.isOnceDownload
                            ) {
                                clearInterval(this.compileInterval);
                                this.compileInterval = setInterval(() => {
                                    this.loadTypes(options);
                                }, this.downloadTimeout);
                            }

                            this.generateTypes(compiler, compilation, options);
                        } else if (!this.isAlreadyCompiled) {
                            Helper.logger.log('Compile declare files on startup only');
                            this.generateTypes(compiler, compilation, options);
                        }
                    },
                );
            });
        }

        if ((this.remoteUrls || options.some((option) => option.remotes)) && !this.isDownloadDisabled) {
            compiler.hooks.watchRun.tap(pluginName, () => {
                if (!this.isAlreadyDownloaded) {
                    Helper.logger.log('Initial loading of declare files');
                    return this.loadTypes(options);
                }
                return Promise.resolve();
            });
        }
        return;
    }

    private checkInputs() {
        const log: IPluginValidationLog[] = [];
        if (this.isTypeGenDisabled && this.isDownloadDisabled) {
            log.push({ message: 'The compilation and download functions are disabled', type: 'log', exit: true });
            return log;
        }
        if (this.remoteUrls && !Helper.checkUrl(Object.values(this.remoteUrls))) {
            log.push({ message: 'ERROR: One or more provided URLs are invalid', type: 'error', exit: true });
            return log;
        }
        return log;
    }

    private generateTypes(compiler: WebpackCompiler, compilation: Compilation, options: TModuleFederationOptions[]) {
        const printError = (mainMessage: string) => {
            Helper.logger.error(mainMessage);
            if (!Helper.checkLogLevel(compiler)) {
                Helper.logger.warn('WARNING: Set infrastructureLogging level to "log" to see error details.');
            }
        };

        const generator = new Compiler(this.tsConfigPath, this.globalTypesDir);

        const { hasError, contents } = options.reduce(
            (acc, option) => {
                const content = generator.createDeclareContent(option);

                if (content === undefined) {
                    return { ...acc, hasError: true };
                } else {
                    return { ...acc, contents: { ...acc.contents, ...content } };
                }
            },
            { hasError: false, contents: {} as TLooseObject<string | undefined> },
        );

        if (!Object.keys(contents).length) {
            printError('ERROR: Failed to compile types for all exposed modules.');
        } else {
            this.isAlreadyCompiled = true;
            if (hasError) {
                printError('ERROR: Failed to compile types for one or more exposed modules.');
            }
            Object.entries(contents).forEach(([fileName, content]) => {
                if (content !== undefined) {
                    compilation.emitAsset(`${this.rootDir}${this.emitedFileDir}${fileName}`, new sources.RawSource(content));
                }
            });
        }
    }

    private async loadTypes(options: TModuleFederationOptions[]) {
        this.isAlreadyDownloaded = true;
        const remotes = options.reduce(
            (acc: TLooseObject, option) => ({ ...acc, ...((option.remotes as TLooseObject) || {}) }),
            {},
        );
        const loader = new Loader(
            remotes as TLooseObject,
            this.remoteUrls,
            this.emitedFileDir,
            this.loadTypesDir,
            this.sslVerify,
        );
        return loader.get();
    }
}
