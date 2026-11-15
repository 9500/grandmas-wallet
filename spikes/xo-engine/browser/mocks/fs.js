// The state package imports these for its SQLite driver, which a browser never uses.
export const existsSync = () => false;
export const mkdirSync = () => undefined;
export default { existsSync, mkdirSync };
