## Webpack-Module-Federation-Types-Advanced-Plugin

Webpack Plugin that works in conjunction with the ModuleFederationPlugin to generate and share declare files for TypeScript.

This plugin uses the Webpack 5 asset module to share declare files.

### Installation

```
npm i webpack-module-federation-types-advanced-plugin
```

### Usage

```javascript
  new ModuleFederationTypesAdvancedPlugin(configuration?: Configuration),
```

### Configuration

|              Setting |   Value   |             Default              |
| -------------------: | :-------: | :------------------------------: |
|         `remoteUrls` | `object`  |               `{}`               |
|            `rootDir` | `string`  |               `/`                |
|      `emitedFileDir` | `string`  |              `@ts`               |
|     `globalTypesDir` | `string`  |            `src/@ts/`            |
|       `loadTypesDir` | `string`  |        `src/@ts/remotes/`        |
|    `downloadTimeout` | `number`  |             `60000`              |
|  `isTypeGenDisabled` | `boolean` |             `false`              |
| `isDownloadDisabled` | `boolean` |             `false`              |
|     `isOnceDownload` | `boolean` |             `false`              |
|       `tsConfigPath` | `string`  |         `tsconfig.json`          |
|   `continuouslySync` | `string`  | `options.mode === 'development'` |
