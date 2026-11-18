/**
 * The token the Send screen opens with, when another screen leads there with one chosen: `fungible:<category>`
 * or `nft:<outpoint>`. Taken once.
 */
let chosen: string | undefined;

export const chooseToken = (key: string): void => {
  chosen = key;
};

export const takeChosenToken = (): string | undefined => {
  const taken = chosen;
  chosen = undefined;
  return taken;
};
