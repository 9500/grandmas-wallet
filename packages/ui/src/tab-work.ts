/*
 * What a tab is in the middle of, for the turn-taking between tabs of the same page (tab.tsx): a newer tab waits,
 * within a limit, for signing, sending and writing to end before it takes the page over.
 */

let working = 0;

/** Something that should not be cut off began or ended in this tab. */
export const tabWork = {
  begin: (): void => {
    working += 1;
  },
  end: (): void => {
    working = Math.max(0, working - 1);
  },
  busy: (): boolean => working > 0,
};
