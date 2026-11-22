import { describe, expect, it } from 'vitest';

import { screenKey, visitOf } from '../src/components.js';

/**
 * The pages' navigation: each choice of a tab is a new visit, and the screen of a route is keyed by its visit, so that a
 * tap on the tab already shown brings it back to its first screen (an Apps sub-screen to the Apps list), as a tap on
 * another tab and back did.
 */

describe('choosing a tab', () => {
  it('starts the screen afresh, also when it is the tab already shown', () => {
    const first = { route: 'apps', visit: 0 };
    const again = visitOf(first, 'apps');
    expect(again).toEqual({ route: 'apps', visit: 1 });
    expect(screenKey(again)).not.toBe(screenKey(first));
    const elsewhere = visitOf(again, 'send');
    expect(elsewhere.route).toBe('send');
    expect(new Set([first, again, elsewhere, visitOf(elsewhere, 'apps')].map(screenKey)).size).toBe(4);
  });
});
