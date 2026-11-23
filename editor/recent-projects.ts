// Recently opened projects and the project in the URL. Both are browser-local: the IDE keeps no
// session state on disk, and the project a run belongs to is a parameter of every API call.

const KEY = 'testframe.recentProjects';
const MAX = 8;

const read = (): string[] => {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

export const getRecentProjects = (): string[] => read();

export const touchRecentProject = (name: string): void => {
  if (!name) return;
  window.localStorage.setItem(KEY, JSON.stringify([name, ...read().filter((n) => n !== name)].slice(0, MAX)));
};

export const forgetRecentProject = (name: string): void => {
  window.localStorage.setItem(KEY, JSON.stringify(read().filter((n) => n !== name)));
};

/** The selected project lives in the URL (?project=name); none selected = the project picker. */
export const projectFromUrl = (): string | null => new URLSearchParams(window.location.search).get('project');

export const setProjectInUrl = (name: string | null, replace = false): void => {
  const url = new URL(window.location.href);
  if (name) url.searchParams.set('project', name);
  else url.searchParams.delete('project');
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
};

/** The environment a project was last opened with (per project, browser-local). */
const envKey = (project: string): string => `testframe.environment.${project}`;

export const storedEnvironment = (project: string): string | null => window.localStorage.getItem(envKey(project));

export const storeEnvironment = (project: string, env: string): void => {
  window.localStorage.setItem(envKey(project), env);
};
