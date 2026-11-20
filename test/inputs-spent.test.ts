import { InputsSpentError, inputsSpentRefusal } from '@grandmas-wallet/app';
import { ACTION_ERROR_CODES, isActionErrorCode } from '@grandmas-wallet/connect';
import { describe, expect, it } from 'vitest';

/**
 * Which refusals of the network the wallet reports to an application as `inputs-spent`: a coin of the transaction
 * was spent first by another transaction, or is not there. The engine passes the node's words on inside its own
 * messages; the wallet tells the refusals apart by those words (docs/xo-feedback-notes.md).
 */
describe('a refusal because a coin was spent first', () => {
  it('is told by the words the nodes use, as the engine and the servers pass them on', () => {
    for (const said of [
      'Transaction broadcast failed for transaction hash "98f2" of invitation "7b85": Error: Failed to broadcast transaction: Error: Failed to request \'blockchain.transaction.broadcast\': the transaction was rejected by network rules.\n\ntxn-mempool-conflict (code 18)',
      'The transaction was refused: bad-txns-inputs-missingorspent',
      'the transaction was rejected by network rules.\n\nMissing inputs (code -25)',
      'missing-inputs',
      'bad-txns-inputs-spent',
    ]) {
      expect(inputsSpentRefusal(said)).toBe(true);
    }
  });

  it('is not any other refusal, nor a conflict among the engine\'s own invitations, which never reached the network', () => {
    for (const said of [
      'the transaction was rejected by network rules.\n\nnon-BIP68-final (code 64)',
      'the transaction was rejected by network rules.\n\nnon-final (code 64)',
      'mandatory-script-verify-flag-failed (Script evaluated without error but finished with a false/empty top stack element)',
      'UnspentOutputReservationExternalConflictError: the output is reserved by another invitation',
      'min relay fee not met',
      'transaction already in block chain',
    ]) {
      expect(inputsSpentRefusal(said)).toBe(false);
    }
  });

  it('travels to the application as a code the protocol names, the same for every application', () => {
    const error = new InputsSpentError('txn-mempool-conflict');
    expect(error.code).toBe('inputs-spent');
    expect(isActionErrorCode(error.code)).toBe(true);
    expect(ACTION_ERROR_CODES).toEqual(['inputs-spent']);
    expect(isActionErrorCode('ECONNRESET')).toBe(false);
  });
});
