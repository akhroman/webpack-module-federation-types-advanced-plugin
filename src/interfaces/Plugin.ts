import { container } from 'webpack';
import { TLooseObject } from './Common';

export interface IModuleFederationTypesAdvancedPluginOption {
    remoteUrls?: TLooseObject;
    rootDir?: string;
    emitedFileDir?: string;
    globalTypesDir?: string;
    loadTypesDir?: string;
    downloadTimeout?: number;
    isTypeGenDisabled?: boolean;
    isDownloadDisabled?: boolean;
    isOnceDownload?: boolean;
    tsConfigPath?: string;
    continuouslySync?: boolean;
}

export type TModuleFederationOptions = ConstructorParameters<typeof container.ModuleFederationPlugin>[0];

export interface IPluginValidationLog {
    type: 'log' | 'warn' | 'error';
    message: string;
    exit: boolean;
}
