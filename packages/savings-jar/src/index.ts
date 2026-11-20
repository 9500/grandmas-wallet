/**
 * The Savings Jar application's own definitions: its XO template and its script. No wallet depends on this
 * package: a wallet learns of the template when the application presents it.
 */

// The template, as the text a wallet is sent and names by hash.
export { savingsJarV4TemplateText } from './frozen.js';
export * from './script.js';
export { savingsJarV4TemplateSource } from './template-source.js';
