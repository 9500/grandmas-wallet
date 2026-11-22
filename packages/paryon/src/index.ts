/**
 * ParyonUSD for this project's demonstration: the deployment's parameters, its contracts built from the
 * published artifacts (`@paryonusd/contracts` 1.1.0, unchanged), reading its live outputs, finding a loan from
 * its key, the contracts' arithmetic, a borrower's transactions built by plain script, the XO template through
 * which this project's wallet carries the same actions out, and what the loan's page asks of the wallet. No wallet
 * depends on this package: a wallet learns of the template when the page presents it.
 */
export * from './amounts.js';
export * from './contract.js';
export * from './deployment.js';
// The names without a version mean version 2, which the pages and runs send until the wallet works with a service.
export {
  paryonChipnetTemplateText,
  paryonChipnetTemplateTextV1,
  paryonChipnetTemplateTextV2,
  paryonChipnetTemplateTextV3,
  paryonMainnetTemplateText,
  paryonMainnetTemplateTextV1,
  paryonMainnetTemplateTextV2,
  paryonMainnetTemplateTextV3,
} from './frozen.js';
export * from './live.js';
export * from './local-deployment.js';
export * from './oracle.js';
export * from './page-requests.js';
export * from './service.js';
export * from './state.js';
export * from './template.js';
export {
  type ParyonAction,
  type ParyonAddresses,
  type ParyonTemplateSource,
  type ParyonTemplateVersion,
  PARYON_ADDRESSES,
  PARYON_SERVICE_SPLIT,
  PARYON_TEMPLATE_VERSION,
  SERVICE_RESOURCE,
  paryonAddressesAt,
  paryonTemplateSource,
} from './template-source.js';
export * from './transactions.js';
