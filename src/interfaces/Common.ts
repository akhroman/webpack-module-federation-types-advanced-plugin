import { Compiler } from 'webpack';

export type TURLObject = Record<string, URL>;

export type TLooseObject<T = string> = Record<string, T>;

export type TLogger = ReturnType<typeof Compiler.prototype.getInfrastructureLogger>;
