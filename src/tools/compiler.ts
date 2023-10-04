import ts from 'typescript';
import { TLooseObject } from '../interfaces/Common';
import { Helper } from './helpers';
import { TModuleFederationOptions } from '../interfaces/Plugin';

export class Compiler {
    public declareFiles: TLooseObject<string | undefined> = {};
    public postProcessingContent?: TLooseObject<string | undefined>;
    public isSucces: undefined | boolean;

    constructor(public tsConfigPath: string, public globalTypesDirPath: string) {}

    public static getConfigFile(tsConfigPath: string) {
        const configFileName = ts.findConfigFile('./', ts.sys.fileExists, tsConfigPath);
        if (!configFileName) {
            Helper.logger.error('ERROR: Could not find a tsconfig.json');
            process.exit(1);
        }
        const { config = {}, error } = ts.readConfigFile(configFileName, ts.sys.readFile);
        if (error) {
            this.reportDiagnostic(error);
        }
        return {
            ...config,
            compilerOptions: {
                ...config.compilerOptions,
                allowJs: false,
            },
        };
    }

    public static reportDiagnostic(diagnostic: ts.Diagnostic) {
        Helper.logger.error(
            'TS ERROR',
            diagnostic.code,
            ':',
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ts.sys.newLine),
        );
    }

    private getDeclareString(filePath: string, fileName: string, packageName: string) {
        return `
            declare module "${filePath}/${fileName}" {
                export * from "${packageName}"
            }
        `;
    }

    private postGenProcess(content: string, options: TModuleFederationOptions) {
        const { exposes, name: fileName = '' } = options;
        const regExp = /declare module "(.*)"/g;

        return [...content.matchAll(regExp)].reduce((acc: string, [, match]) => {
            const [exp, ...aliases] = Object.entries(exposes as TLooseObject)
                .filter(([, path]) => path.endsWith(match) || path.replace(/\.[^./]*$/, '').endsWith(match))
                .map(([key]) => key.replace(/^\.\//, ''));
            const nodePath = Object.entries(exposes as TLooseObject)
                .filter(([, path]) => !path.startsWith('.') || path.startsWith('./node_modules/'))
                .map(([key, path]) => [key.replace(/^\.\//, ''), path.replace('./node_modules/', '')])
                .map(([key, path]) => this.getDeclareString(fileName, key, path));

            const modulePath = (exp ? `${fileName}/${exp}` : `#non-importable/${fileName}/${match}`).replace(/\/index$/, '');
            const aliasPath = aliases.map((alias) => this.getDeclareString(fileName, alias, modulePath));

            if (nodePath?.length) {
                Helper.logger.log('Including typings for npm packages:', nodePath);
            }

            return [acc.replace(RegExp(`"${match}"`, 'g'), `"${modulePath}"`), ...aliasPath, ...nodePath].join('\n');
        }, content);
    }

    public createDeclareContent(options: TModuleFederationOptions) {
        if (!options) {
            Helper.logger.error('ERROR: ModuleFederationPlugin options not passed');
            process.exit(1);
        }
        const { exposes = {}, name: fileName } = options;
        const globalTypesFiles = Helper.getDirFiles(this.globalTypesDirPath).filter((path) => path.endsWith('.d.ts'));
        const exposedList = [...Object.values(exposes), ...globalTypesFiles];

        const { compilerOptions = {} } = Compiler.getConfigFile(this.tsConfigPath);
        const { moduleResolution, paths, rootDirs, ...currentCompilerOption } = compilerOptions as ts.CompilerOptions;
        const compilerOption: ts.CompilerOptions = {
            ...currentCompilerOption,
            noEmitOnError: false,
            lib: currentCompilerOption.lib?.map((lib) => (lib.includes('.d.ts') ? lib : `lib.${lib}.d.ts`).toLowerCase()),
            emitDeclarationOnly: true,
            declaration: true,
            noEmit: false,
            outFile: `${fileName}.d.ts`,
        };
        const compilerHost = ts.createCompilerHost(compilerOption);
        compilerHost.writeFile = (declareFileName, data) =>
            (this.declareFiles[declareFileName] = Boolean(data) ? this.postGenProcess(data, options) : undefined);

        const compilerProgram = ts.createProgram(exposedList, compilerOption, compilerHost);
        const { emitSkipped, diagnostics } = compilerProgram.emit();

        diagnostics.forEach(Compiler.reportDiagnostic);

        this.isSucces = !!!emitSkipped;
        this.postProcessingContent = this.isSucces && Object.values(this.declareFiles).length ? this.declareFiles : undefined;
        return this.postProcessingContent;
    }
}
