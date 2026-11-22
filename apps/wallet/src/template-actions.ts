import { type ApplicationAction, type Applications, type RecordedPosition, type ServiceStatus, type TemplateAction, type TemplateActions, type TemplateSummary, type TokenAction, SERVICE_WORDS } from '@grandmas-wallet/app';

/**
 * What the wallet's screens show about a template's actions and its service, apart from how they look: the service's
 * state in a few words, which actions get a button and which are only named, the tokens the wallet made that wait
 * elsewhere, and the request an action screen asks the wallet to work out. Every name comes from the template; nothing
 * here names an application, a template or an action.
 */

/** How a screen writes a time given in Unix seconds. */
export type TimeWords = (seconds: number) => string;

/** The host of a service's address, as the screens name it; `undefined` for an address that cannot be read. */
export const serviceHost = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined;
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
};

/** A template's service, as its card shows it. */
export interface ServiceShown {
  /** Where it is: the host of its address, or the template's words for it where the address cannot be used. */
  name: string;
  /** Its state, in a few words. */
  state: string;
  /** When: the time its last answer came, or its last exchange failed. */
  when?: string;
  /** Why it was not reached, in the client's plain words: shown under the state. */
  failure?: string;
  /** Why its address cannot be used: behind a "?". */
  problem?: string;
  /** `Connect` where it was never asked or not reached, a quiet `Check again` where it was reached; none where its address cannot be used. */
  button?: 'Connect' | 'Check again';
}

export const serviceShown = (status: ServiceStatus, time: TimeWords): ServiceShown => {
  const name = serviceHost(status.url) ?? (status.description === '' ? 'The template\'s service' : status.description);
  switch (status.state) {
    case 'reached': {
      const at = status.checkedAt ?? status.reachedAt;
      return { name, state: 'Connected', ...(at === undefined ? {} : { when: `Checked ${time(at)}` }), button: 'Check again' };
    }
    case 'never asked':
      return { name, state: 'Not asked yet', button: 'Connect' };
    case 'not reached':
      return { name, state: 'Not reached', ...(status.failure === undefined ? {} : { when: `Tried ${time(status.failure.at)}`, failure: status.failure.message }), button: 'Connect' };
    case 'not usable':
      return { name, state: 'Address not usable', ...(status.problem === undefined ? {} : { problem: status.problem }) };
  }
};

/** A service the wallet can speak to: it names one, with an address the wallet can use. */
export const usableService = (status: ServiceStatus | undefined): status is ServiceStatus => status !== undefined && status.state !== 'not usable';

/** A service whose word on a token has not been had yet: the screens offer Connect in its place. */
export const notAsked = (status: ServiceStatus | undefined): boolean => status?.state === 'never asked' || status?.state === 'not reached';

/** "Checked with its service <time>", for the latest answer the offered actions come from; none where none of them is the service's. */
export const checkedLine = (actions: TokenAction[], time: TimeWords): string | undefined => {
  const times = actions.flatMap((action) => (action.service?.checkedAt === undefined ? [] : [action.service.checkedAt]));
  return times.length === 0 ? undefined : SERVICE_WORDS.checked(time(Math.max(...times)));
};

/** Why a starting action is not offered now, in the service's own words; `undefined` where it is, or where the service was never asked. */
export const unavailable = (action: TokenAction): string | undefined => (action.service?.available === false ? `The service says: ${action.service.reason ?? 'not now.'}` : undefined);

/**
 * A value in a line of text, by the template's type for it: numbers grouped, satoshis and token amounts with their unit
 * as the action's form names them; anything else as it is.
 */
export const typedWords = (type: string | undefined, value: string): string => {
  if (!/^-?\d+$/.test(value)) return value;
  const grouped = BigInt(value).toLocaleString('en-US');
  return type === 'satoshis' ? `${grouped} sat` : type === 'token_amount' ? `${grouped} units` : type === 'integer' || type === 'bigint' ? grouped : value;
};

/** The values the service states beside an action, in one short line with the template's names. */
export const saysLine = (action: TokenAction): string | undefined => {
  const says = action.service?.says ?? [];
  return says.length === 0 ? undefined : `${SERVICE_WORDS.fromService}: ${says.map(({ name, value, type }) => `${name} ${typedWords(type, value)}`).join(' · ')}`;
};

/** A token the wallet made with a template and does not hold, with the actions its service offers for it. */
export interface WaitingToken {
  category: string;
  /** The template's name for where it waits. */
  at: string;
  actions: TemplateAction[];
}

/** A template's actions, as its screen lists them. */
export interface ActionsShown {
  /** The starting actions: each with a button. */
  starting: TemplateAction[];
  /** Where they are under more than one role: the template's name for each action's role, by its place among them. */
  roles?: string[];
  /** The template's other actions: named, with their description, and done from the token they act on. */
  others: { action: string; name: string; description: string }[];
  /** Tokens the wallet made that wait elsewhere, one entry each, with the actions offered for them. */
  waiting: WaitingToken[];
}

export const actionsShown = (summary: Pick<TemplateSummary, 'actions'>, offered: Pick<TemplateActions, 'starting' | 'waiting' | 'roleNames'>): ActionsShown => {
  const starting = new Set(offered.starting.map(({ action }) => action));
  const others = summary.actions.filter((action, index) => !starting.has(action.action) && summary.actions.findIndex((other) => other.action === action.action) === index);
  const waiting: WaitingToken[] = [];
  for (const action of offered.waiting) {
    if (action.waiting === undefined) continue;
    const known = waiting.find((entry) => entry.category === action.waiting?.category);
    if (known === undefined) waiting.push({ category: action.waiting.category, at: action.waiting.at, actions: [action] });
    else if (!known.actions.some((other) => other.action === action.action)) known.actions.push(action);
  }
  const { roleNames } = offered;
  const roles = roleNames === undefined ? undefined : offered.starting.map(({ role }) => roleNames[role] ?? role);
  return { starting: offered.starting, ...(roles === undefined ? {} : { roles }), others, waiting };
};

/**
 * What an action screen acts on: a token the wallet holds, nothing yet (a starting action, under the role its offer
 * names), or a token it made that waits elsewhere.
 */
export type ActTarget =
  | { kind: 'token'; position: RecordedPosition }
  | { kind: 'start'; template: { identifier: string; name: string }; role: string }
  | { kind: 'waiting'; template: { identifier: string; name: string }; category: string; at: string };

/** The request the wallet works out for an action screen, with what the user typed. */
export const requestFor = (applications: Pick<Applications, 'actionOn' | 'startAction' | 'waitingAction'>, target: ActTarget, action: string, typed: Record<string, string>): ApplicationAction => {
  switch (target.kind) {
    case 'token':
      return applications.actionOn(target.position, action, typed);
    case 'start':
      return applications.startAction(target.template.identifier, action, typed, target.role);
    case 'waiting':
      return applications.waitingAction(target.template.identifier, target.category, action, typed);
  }
};

/** The template an action screen's target belongs to, by its name. */
export const targetTemplateName = (target: ActTarget): string | undefined => (target.kind === 'token' ? target.position.template.name : target.template.name);
