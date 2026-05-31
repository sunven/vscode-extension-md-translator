"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProvider = void 0;
const googleClient_1 = require("./googleClient");
const microsoftClient_1 = require("./microsoftClient");
const openaiProvider_1 = require("./openaiProvider");
function resolveProvider(id) {
    switch (id) {
        case 'google':
            return googleClient_1.googleProvider;
        case 'microsoft':
            return microsoftClient_1.microsoftProvider;
        case 'ai':
            return openaiProvider_1.openAIProvider;
        default:
            throw new Error(`Unknown translation provider: ${id}`);
    }
}
exports.resolveProvider = resolveProvider;
//# sourceMappingURL=translationProvider.js.map