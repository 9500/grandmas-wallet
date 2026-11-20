/**
 * ParyonUSD for this project's demonstration: the deployment's parameters, its contracts built from the
 * published artifacts (`@paryonusd/contracts` 1.1.0, unchanged), reading its live outputs, finding a loan from
 * its key, the contracts' arithmetic, a borrower's transactions built by plain script, and the XO template with
 * its recovery declaration through which a wallet of the second design carries the same actions out, and what the
 * loan's page asks of the wallet: with the declaration (version 1 of `xo_v1`), and without one (version 2). No wallet depends on this package: a wallet learns of the template when the
 * page presents it.
 */
export * from './amounts.js';
export * from './contract.js';
export * from './deployment.js';
export { paryonChipnetDeclarationText, paryonChipnetTemplateText } from './frozen.js';
export * from './live.js';
export * from './local-deployment.js';
export * from './oracle.js';
export * from './page-requests.js';
export * from './requests.js';
export * from './state.js';
export * from './template.js';
export { paryonDeclarationSource, paryonTemplateSource } from './template-source.js';
export * from './transactions.js';
