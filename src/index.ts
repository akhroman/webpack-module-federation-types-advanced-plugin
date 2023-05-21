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

    continuouslySync?: boolean;
    isAlreadyCompiled: boolean = false;
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
        tsConfigPath = 'tsconfig.json',
        continuouslySync,
    }: IModuleFederationTypesAdvancedPluginOption) {
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
                    (assets) => {
                        if (this.continuouslySync) {
                            Helper.logger.log('Compiling declare files on emit event');
                            if ((this.remoteUrls || options.some((option) => option.remotes)) && !this.isDownloadDisabled) {
                                clearInterval(this.compileInterval);
                                this.compileInterval = setInterval(() => {
                                    Helper.logger.log(`Downloading declare files every ${this.downloadTimeout} ms`);
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
            compiler.hooks.beforeCompile.tapAsync(pluginName, async () => {
                Helper.logger.log('Initial loading of declare files');
                await this.loadTypes(options);
            });
        }
    }

    private checkInputs() {
        const log: IPluginValidationLog[] = [];
        if (this.isTypeGenDisabled && this.isDownloadDisabled) {
            log.push({ message: 'The compilation and download functions are disabled', type: 'log', exit: true });
            return log;
        }
        if (this.remoteUrls) {
            const checkUrlInfo = Helper.checkUrl(Object.values(this.remoteUrls));
            checkUrlInfo === 'SOME' && log.push({ message: 'WARNINIG: One or more URLs are invalid', type: 'warn', exit: false });
            checkUrlInfo === 'NONE' && log.push({ message: 'ERROR: All provided URLs are invalid', type: 'error', exit: true });
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
                generator.federationOptions = option;
                const content = generator.createDeclareContent();

                if (content === undefined) {
                    return { ...acc, hasError: true };
                } else {
                    return { ...acc, contents: { ...acc.contents, ...content } };
                }
            },
            { hasError: false, contents: {} as TLooseObject },
        );

        if (!Object.keys(contents).length) {
            printError('ERROR: Failed to compile types for all exposed modules.');
        } else {
            this.isAlreadyCompiled = true;
            if (hasError) {
                printError('ERROR: Failed to compile types for one or more exposed modules.');
            }
            Object.entries(contents).forEach(([fileName, content]) =>
                compilation.emitAsset(`${this.rootDir}${this.emitedFileDir}${fileName}`, new sources.RawSource(content)),
            );
        }
    }

    private async loadTypes(options: TModuleFederationOptions[]) {
        const remotes = options.reduce((acc: TLooseObject, option) => ({ ...acc, ...(option.remotes || {}) }), {});
        const loader = new Loader(remotes as TLooseObject, this.remoteUrls, this.emitedFileDir, this.loadTypesDir);
        await loader.get();
    }
}
