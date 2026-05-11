"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discardLastPendingMarkdownTranslation = exports.replaceLastPendingMarkdownTranslation = exports.translateMarkdownToChinese = exports.TranslatedMarkdownContentProvider = exports.discardLastTranslationCommand = exports.replaceLastTranslationCommand = void 0;
const path = require("path");
const vscode = require("vscode");
const config_1 = require("./config");
const markdownSegments_1 = require("./markdownSegments");
const openaiClient_1 = require("./openaiClient");
const replaceSourceAction = 'Replace Source';
const discardAction = 'Discard';
exports.replaceLastTranslationCommand = 'mdTranslator.replaceLastTranslation';
exports.discardLastTranslationCommand = 'mdTranslator.discardLastTranslation';
let pendingMarkdownTranslation;
class TranslatedMarkdownContentProvider {
    static scheme = 'md-translator-translated';
    content = new Map();
    changeEmitter = new vscode.EventEmitter();
    onDidChange = this.changeEmitter.event;
    provideTextDocumentContent(uri) {
        return this.content.get(uri.toString()) ?? '';
    }
    setContent(uri, content) {
        this.content.set(uri.toString(), content);
        this.changeEmitter.fire(uri);
    }
}
exports.TranslatedMarkdownContentProvider = TranslatedMarkdownContentProvider;
const defaultMarkdownTranslationDependencies = {
    readTranslationSettings: config_1.readTranslationSettings,
    getApiKey: config_1.getApiKey,
    promptAndStoreApiKey: config_1.promptAndStoreApiKey,
    readFile: uri => vscode.workspace.fs.readFile(uri),
    writeFile: (uri, data) => vscode.workspace.fs.writeFile(uri, data),
    showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
    showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    showErrorMessage: message => vscode.window.showErrorMessage(message),
    createStatusBarItem: (alignment, priority) => vscode.window.createStatusBarItem(alignment, priority),
    withProgress: (options, task) => vscode.window.withProgress(options, task),
    executeCommand: (command, ...rest) => vscode.commands.executeCommand(command, ...rest),
    parseMarkdownSegments: markdownSegments_1.parseMarkdownSegments,
    createTranslationBatches: markdownSegments_1.createTranslationBatches,
    translateSegmentsWithOpenAI: openaiClient_1.translateSegmentsWithOpenAI,
    applyTranslations: markdownSegments_1.applyTranslations,
    validateTranslatedMarkdown: markdownSegments_1.validateTranslatedMarkdown
};
async function translateMarkdownToChinese(context, contentProvider, uri, dependencies = defaultMarkdownTranslationDependencies) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!sourceUri) {
        await dependencies.showWarningMessage('Open a Markdown file or run this command from a Markdown file context.');
        return;
    }
    if (path.extname(sourceUri.fsPath) !== '.md') {
        await dependencies.showWarningMessage('This command only works with .md files');
        return;
    }
    const settings = dependencies.readTranslationSettings();
    const apiKey = await dependencies.getApiKey(context);
    if (!apiKey) {
        const choice = await dependencies.showWarningMessage('OpenAI-compatible API key is not set.', 'Set API Key', 'Cancel');
        if (choice === 'Set API Key') {
            await dependencies.promptAndStoreApiKey(context);
        }
        return;
    }
    const originalBytes = await dependencies.readFile(sourceUri);
    const originalText = Buffer.from(originalBytes).toString('utf8');
    const parsed = dependencies.parseMarkdownSegments(originalText);
    if (parsed.segments.length === 0) {
        await dependencies.showInformationMessage('No English prose segments found to translate.');
        return;
    }
    const batches = dependencies.createTranslationBatches(parsed.segments, settings.maxChunkChars);
    const translations = new Map();
    let translatedText = '';
    const loading = dependencies.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    loading.text = '$(sync~spin) Translating Markdown to Chinese';
    loading.tooltip = 'Markdown translation is running';
    loading.show();
    try {
        await dependencies.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Translating Markdown to Chinese',
            cancellable: true
        }, async (progress, cancellationToken) => {
            await translateBatchesIntoMap({
                apiKey,
                batches,
                cancellationToken,
                dependencies,
                loading,
                progress,
                settings,
                translations
            });
            progress.report({ message: 'Applying translations' });
            translatedText = dependencies.applyTranslations(parsed, translations);
            if (translatedText === originalText) {
                if (cancellationToken.isCancellationRequested) {
                    throw new Error('Translation cancelled.');
                }
                translations.clear();
                const retryLabel = 'Retrying unchanged translation';
                loading.text = `$(sync~spin) ${retryLabel}`;
                loading.tooltip = retryLabel;
                progress.report({ message: retryLabel });
                await translateBatchesIntoMap({
                    apiKey,
                    attemptLabel: 'Retry',
                    batches,
                    cancellationToken,
                    dependencies,
                    loading,
                    progress,
                    settings: {
                        ...settings,
                        targetLanguage: buildStrictRetryTargetLanguage(settings.targetLanguage)
                    },
                    translations
                });
                progress.report({ message: 'Applying translations' });
                translatedText = dependencies.applyTranslations(parsed, translations);
            }
        });
    }
    finally {
        loading.dispose();
    }
    const validation = dependencies.validateTranslatedMarkdown(originalText, translatedText);
    if (!validation.valid) {
        await dependencies.showErrorMessage(buildValidationFailureMessage(validation.errors));
        return;
    }
    const translatedUri = createTranslatedMarkdownUri(sourceUri);
    contentProvider.setContent(translatedUri, translatedText);
    await dependencies.executeCommand('vscode.diff', sourceUri, translatedUri, `${path.basename(sourceUri.fsPath)}: Original ↔ Chinese translation`);
    setPendingMarkdownTranslation({
        sourceUri,
        originalText,
        translatedText,
        replaceStatusBarItem: createPendingTranslationStatusBarItem(dependencies, '$(check) Replace Translation', 'Replace the source Markdown with the pending translation', exports.replaceLastTranslationCommand, 99),
        discardStatusBarItem: createPendingTranslationStatusBarItem(dependencies, '$(close) Discard Translation', 'Discard the pending Markdown translation', exports.discardLastTranslationCommand, 98)
    });
    const action = await dependencies.showInformationMessage('Review the Markdown diff before replacing the source file.', replaceSourceAction, discardAction);
    if (action === discardAction) {
        discardPendingMarkdownTranslation();
        return;
    }
    if (action !== replaceSourceAction) {
        return;
    }
    await replacePendingMarkdownTranslation(dependencies);
}
exports.translateMarkdownToChinese = translateMarkdownToChinese;
async function replaceLastPendingMarkdownTranslation(dependencies = defaultMarkdownTranslationDependencies) {
    await replacePendingMarkdownTranslation(dependencies);
}
exports.replaceLastPendingMarkdownTranslation = replaceLastPendingMarkdownTranslation;
function discardLastPendingMarkdownTranslation() {
    discardPendingMarkdownTranslation();
}
exports.discardLastPendingMarkdownTranslation = discardLastPendingMarkdownTranslation;
async function translateBatchesIntoMap(args) {
    const { apiKey, attemptLabel, batches, cancellationToken, dependencies, loading, progress, settings, translations } = args;
    const progressIncrement = 100 / batches.length;
    progress.report({ message: `0 of ${batches.length} chunks complete` });
    for (let index = 0; index < batches.length; index += 1) {
        if (cancellationToken.isCancellationRequested) {
            throw new Error('Translation cancelled.');
        }
        const chunkLabel = `${attemptLabel ? `${attemptLabel} ` : ''}Chunk ${index + 1} of ${batches.length}`;
        loading.text = `$(sync~spin) ${chunkLabel}`;
        loading.tooltip = chunkLabel;
        const batch = batches[index];
        let batchTranslations;
        try {
            batchTranslations = await translateBatchWithRecovery(dependencies.translateSegmentsWithOpenAI, {
                ...settings,
                apiKey
            }, batch);
        }
        catch (error) {
            throw buildBatchTranslationError(error, index, batches.length, batch);
        }
        for (const [id, translatedText] of batchTranslations) {
            translations.set(id, translatedText);
        }
        progress.report({
            message: `${index + 1} of ${batches.length} chunks complete`,
            increment: progressIncrement
        });
    }
}
async function replacePendingMarkdownTranslation(dependencies) {
    const pending = pendingMarkdownTranslation;
    if (!pending) {
        await dependencies.showInformationMessage('No pending Markdown translation to replace.');
        return;
    }
    const currentText = Buffer.from(await dependencies.readFile(pending.sourceUri)).toString('utf8');
    if (currentText !== pending.originalText) {
        await dependencies.showErrorMessage('Source file changed while translation was running. Re-run translation before replacing it.');
        return;
    }
    await dependencies.writeFile(pending.sourceUri, Buffer.from(pending.translatedText, 'utf8'));
    discardPendingMarkdownTranslation();
    await dependencies.showInformationMessage('Markdown source replaced with the Chinese translation.');
}
function setPendingMarkdownTranslation(pending) {
    discardPendingMarkdownTranslation();
    pendingMarkdownTranslation = pending;
    pending.replaceStatusBarItem.show();
    pending.discardStatusBarItem.show();
}
function discardPendingMarkdownTranslation() {
    pendingMarkdownTranslation?.replaceStatusBarItem.dispose();
    pendingMarkdownTranslation?.discardStatusBarItem.dispose();
    pendingMarkdownTranslation = undefined;
}
function createPendingTranslationStatusBarItem(dependencies, text, tooltip, command, priority) {
    const item = dependencies.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
    item.text = text;
    item.tooltip = tooltip;
    item.command = command;
    return item;
}
function buildStrictRetryTargetLanguage(targetLanguage) {
    return `${targetLanguage}. The previous attempt returned unchanged source text. Translate every English prose segment into ${targetLanguage}; do not copy the English source text unless it is a protected term, brand name, code token, URL, or file path.`;
}
function buildValidationFailureMessage(errors) {
    if (errors.length === 1 && errors[0] === 'Translated Markdown is identical to the source.') {
        return [
            'Translation failed because the provider returned unchanged source text.',
            'Try a stronger translation model, lower temperature, or enable JSON response format if your provider supports it.'
        ].join(' ');
    }
    return `Translation validation failed: ${errors.join(' ')}`;
}
async function translateBatchWithRecovery(translateSegments, options, segments) {
    try {
        return await translateSegments(options, segments);
    }
    catch {
        try {
            return await translateSegments(options, segments);
        }
        catch (retryError) {
            if (!canRecoverBySingleSegmentFallback(retryError, segments)) {
                throw retryError;
            }
            const recovered = new Map();
            for (const segment of segments) {
                let segmentTranslations;
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
function canRecoverBySingleSegmentFallback(error, segments) {
    if (segments.length <= 1 || !(error instanceof openaiClient_1.TranslationClientError)) {
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
function buildBatchTranslationError(error, batchIndex, batchCount, segments) {
    const message = error instanceof Error ? error.message : 'Unknown provider error.';
    const status = error instanceof openaiClient_1.TranslationClientError ? error.status : undefined;
    return new openaiClient_1.TranslationClientError(`Chunk ${batchIndex + 1} of ${batchCount} failed for ${formatSegmentIds(segments)}: ${message}`, status);
}
function buildSingleSegmentFallbackError(error, segmentId) {
    const message = error instanceof Error ? error.message : 'Unknown provider error.';
    const status = error instanceof openaiClient_1.TranslationClientError ? error.status : undefined;
    return new openaiClient_1.TranslationClientError(`Single-segment retry failed for ${segmentId}: ${message}`, status);
}
function formatSegmentIds(segments) {
    const ids = segments.map(segment => segment.id);
    if (ids.length === 1) {
        return `segment ${ids[0]}`;
    }
    if (ids.length <= 4) {
        return `segments ${ids.join(', ')}`;
    }
    return `segments ${ids[0]}-${ids[ids.length - 1]} (${ids.length} total)`;
}
function createTranslatedMarkdownUri(sourceUri) {
    const basename = path.basename(sourceUri.fsPath, '.md');
    return vscode.Uri.from({
        scheme: TranslatedMarkdownContentProvider.scheme,
        path: `${sourceUri.path}.${basename}.zh.md`,
        query: String(Date.now())
    });
}
//# sourceMappingURL=translateMarkdown.js.map