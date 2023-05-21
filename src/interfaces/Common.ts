import { Compiler } from 'webpack';

export type TURLObject = Record<string, URL>;

export type TLooseObject = Record<string, string>;

export type TLogger = ReturnType<typeof Compiler.prototype.getInfrastructureLogger>;
