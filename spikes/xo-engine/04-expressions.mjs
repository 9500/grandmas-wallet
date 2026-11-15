// Experiment 4: what do token field expressions accept? Uses the utils compiler directly, as the engine does.
import { compileCashAssemblyString } from '@xo-cash/utils';

const templateVariables = {
  identity: { name: 'i', description: 'i', type: 'token_category' },
  bytesVar: { name: 'b', description: 'b', type: 'bytes' },
  commitmentVar: { name: 'c', description: 'c', type: 'token_commitment' },
  textVar: { name: 't', description: 't', type: 'string' },
};
const variables = { identity: '1111111122222222', bytesVar: 'aabbcc', commitmentVar: '0100aabb', textVar: 'aabbcc' };
const attempt = (label, cashAssemblyText) => {
  try {
    const result = compileCashAssemblyString({ cashAssemblyText, variables, evaluationDecodeMode: 'utf8', templateVariables, templateScripts: {} });
    console.log(label.padEnd(46), JSON.stringify(result));
  } catch (error) {
    console.log(label.padEnd(46), 'ERROR', error.message.slice(0, 120));
  }
};
attempt('pass-through token_category', '$(<identity>)');
attempt('pass-through token_commitment', '$(<commitmentVar>)');
attempt('pass-through bytes', '$(<bytesVar>)');
attempt('pass-through string holding hex', '$(<textVar>)');
attempt('concatenate bytes', '$(<0x0100> <bytesVar> OP_CAT)');
attempt('concatenate hex text', '$(<"0100"> <textVar> OP_CAT)');
attempt('text prefix + evaluation', '0100$(<textVar>)');
attempt('two evaluations side by side', '$(<textVar>)$(<textVar>)');
attempt('hash of bytes', '$(<bytesVar> OP_HASH160)');
