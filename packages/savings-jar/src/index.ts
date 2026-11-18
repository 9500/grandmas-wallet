/**
 * The Savings Jar application's own definitions: its XO template, its recovery declaration and its script.
 * No wallet depends on this package: a wallet learns of the template when the application presents it.
 */

// The template and its recovery declaration as the texts a wallet is sent and names by hash.
export { savingsJarDeclarationText, savingsJarTemplateText } from './frozen.js';
export * from './script.js';
export { savingsJarDeclarationSource, savingsJarTemplateSource } from './template-source.js';
