/**
 * The Savings Jar application's own definitions: its XO template, its script, and, for the wallets of the
 * second design, the template of version 3 with its recovery declaration. No wallet depends on this package: a
 * wallet learns of the template when the application presents it.
 */

// The templates, and the declaration of version 3, as the texts a wallet is sent and names by hash.
export { savingsJarDeclarationText, savingsJarTemplateText, savingsJarV4TemplateText } from './frozen.js';
export * from './script.js';
export { savingsJarDeclarationSource, savingsJarTemplateSource, savingsJarV4TemplateSource } from './template-source.js';
