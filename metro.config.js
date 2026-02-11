const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
    ...(config.resolver.extraNodeModules || {}),
    sharp: path.resolve(__dirname, "src/shims/sharp.ts"),
};

module.exports = config;
