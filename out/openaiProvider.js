"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.translateBatchWithRecovery = exports.openAIProvider = void 0;
const openaiClient_1 = require("./openaiClient");
const translationShared_1 = require("./translationShared");
class OpenAIProvider {
    id = 'ai';
    requiresApiKey = true;
    async translateSegments(segments, context) {
        const options = {
            apiBaseUrl: context.settings.apiBaseUrl,
            apiKey: context.apiKey ?? '',
            model: context.settings.model,
            temperature: context.settings.temperature,
            targetLanguage: context.settings.targetLanguage,
            maxResponseTokens: context.settings.maxResponseTokens,
            requestTimeoutMs: context.settings.requestTimeoutMs,
            useJsonResponseFormat: context.settings.useJsonResponseFormat,
            disableThinking: context.settings.disableThinking,
            forceTranslate: context.settings.forceTranslate
        };
        return translateBatchWithRecovery(openaiClient_1.translateSegmentsWithOpenAI, options, segments, context.reporter);
    }
}
exports.openAIProvider = new OpenAIProvider();
async function translateBatchWithRecovery(translateSegments, options, segments, reporter) {
    try {
        return await translateSegments(options, segments);
    }
    catch (firstError) {
        reporter?.onRetry(firstError);
        try {
            return await translateSegments(options, segments);
        }
        catch (retryError) {
            if (!canRecoverBySingleSegmentFallback(retryError, segments)) {
                throw retryError;
            }
            reporter?.onSingleSegmentFallbackStart(retryError);
            const recovered = new Map();
            for (let index = 0; index < segments.length; index += 1) {
                const segment = segments[index];
                let segmentTranslations;
                reporter?.onSingleSegmentFallbackProgress(index, segments.length);
                try {
                    segmentTranslations = await translateSegments(options, [segment]);
                }
                catch (segmentError) {
                    throw buildSingleSegmentFallbackError(segmentError, segment.id);
                }
                for (const [id, translatedText] of segmentTranslations) {
                    recovered.set(id, translatedText);
                }
            }
            return recovered;
        }
    }
}
exports.translateBatchWithRecovery = translateBatchWithRecovery;
function canRecoverBySingleSegmentFallback(error, segments) {
    if (segments.length <= 1 || !(error instanceof translationShared_1.TranslationClientError)) {
        return false;
    }
    return [
        'Provider returned conflicting translation for segment id:',
        'Provider response is missing segment id:',
        'Provider returned unknown segment id:',
        'Provider returned invalid JSON:',
        'Provider response must contain a translations array.',
        'Provider response did not contain a JSON object.'
    ].some(message => error.message.includes(message));
}
function buildSingleSegmentFallbackError(error, segmentId) {
    const message = error instanceof Error ? error.message : 'Unknown provider error.';
    const status = error instanceof translationShared_1.TranslationClientError ? error.status : undefined;
    return new translationShared_1.TranslationClientError(`Single-segment retry failed for ${segmentId}: ${message}`, status);
}
//# sourceMappingURL=openaiProvider.js.map