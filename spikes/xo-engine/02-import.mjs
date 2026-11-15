// Experiment 2: does the engine accept the trial template, and compile the controller output as our own code does?
import { parseTemplate, generateTemplateIdentifier } from '@xo-cash/utils';
import { spikeTemplate } from './template.mjs';

try {
  const parsed = parseTemplate(spikeTemplate);
  console.log('template valid, identifier', generateTemplateIdentifier(parsed));
} catch (error) {
  console.log('template rejected:\n' + error.message);
}
