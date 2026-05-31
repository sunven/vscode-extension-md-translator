import * as vscode from "vscode";
import { clearApiKey, promptAndStoreApiKey, selectTranslationProvider } from "./config";
import {
	discardLastPendingMarkdownTranslation,
	discardLastTranslationCommand,
	replaceLastPendingMarkdownTranslation,
	replaceLastTranslationCommand,
	TranslatedMarkdownContentProvider,
	translateMarkdownToChinese,
} from "./translateMarkdown";

export function activate(context: vscode.ExtensionContext) {
	console.log("MD AI Translator extension is now active!");

	const translatedMarkdownProvider = new TranslatedMarkdownContentProvider();

	const translateMarkdownCommand = vscode.commands.registerCommand(
		"mdTranslator.translateMarkdownToChinese",
		async (uri?: vscode.Uri) =>
			runWithErrorBoundary("Failed to translate Markdown", () =>
				translateMarkdownToChinese(context, translatedMarkdownProvider, uri),
			),
	);

	const setApiKeyCommand = vscode.commands.registerCommand(
		"mdTranslator.setApiKey",
		async () => promptAndStoreApiKey(context),
	);

	const selectProviderCommand = vscode.commands.registerCommand(
		"mdTranslator.selectProvider",
		async () => selectTranslationProvider(),
	);

	const clearApiKeyCommand = vscode.commands.registerCommand(
		"mdTranslator.clearApiKey",
		async () => clearApiKey(context),
	);

	const replaceLastTranslation = vscode.commands.registerCommand(
		replaceLastTranslationCommand,
		async () =>
			runWithErrorBoundary(
				"Failed to replace Markdown translation",
				replaceLastPendingMarkdownTranslation,
			),
	);

	const discardLastTranslation = vscode.commands.registerCommand(
		discardLastTranslationCommand,
		discardLastPendingMarkdownTranslation,
	);

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(
			TranslatedMarkdownContentProvider.scheme,
			translatedMarkdownProvider,
		),
		translateMarkdownCommand,
		setApiKeyCommand,
		selectProviderCommand,
		clearApiKeyCommand,
		replaceLastTranslation,
		discardLastTranslation,
	);
}

async function runWithErrorBoundary(
	label: string,
	action: () => Promise<void>,
): Promise<void> {
	try {
		await action();
	} catch (error) {
		await vscode.window.showErrorMessage(
			`${label}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

export function deactivate() {
	console.log("MD AI Translator extension is now deactivated!");
}
