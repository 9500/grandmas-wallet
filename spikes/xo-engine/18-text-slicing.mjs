// Experiment 18: can a token field expression cut pieces out of hex text, so the template needs fewer variables?
import { compileCashAssemblyString } from '@xo-cash/utils';
const state = '010100000000' + 'aa'.repeat(20) + 'bb'.repeat(20) + '010040' + 'cc'.repeat(20);
const templateVariables = { controllerState: { name: 's', description: 's', type: 'string' }, proposed: { name: 'p', description: 'p', type: 'bytes' } };
const attempt = (label, cashAssemblyText, expected) => {
  try {
    const result = compileCashAssemblyString({ cashAssemblyText, variables: { controllerState: state, proposed: 'dd'.repeat(20) }, evaluationDecodeMode: 'utf8', templateVariables, templateScripts: { stateBody: '<controllerState> <4> OP_SPLIT OP_NIP <94> OP_SPLIT OP_DROP' } });
    console.log(label.padEnd(34), result === expected ? 'OK' : `DIFFERENT: ${JSON.stringify(result).slice(0, 80)}`);
  } catch (error) { console.log(label.padEnd(34), 'ERROR', error.message.slice(0, 110)); }
};
attempt('active state from current state', `$(<"0100"> <controllerState> <4> OP_SPLIT OP_NIP <94> OP_SPLIT OP_DROP OP_CAT <"${'00'.repeat(20)}"> OP_CAT)`, '0100' + state.slice(4, 98) + '00'.repeat(20));
attempt('pending state', '$(<"0101"> <controllerState> <4> OP_SPLIT OP_NIP <94> OP_SPLIT OP_DROP OP_CAT <proposed> OP_CAT)', '0101' + state.slice(4, 98) + 'dd'.repeat(20));
attempt('using a named script', `$(<"0100"> stateBody OP_CAT <"${'00'.repeat(20)}"> OP_CAT)`, '0100' + state.slice(4, 98) + '00'.repeat(20));
