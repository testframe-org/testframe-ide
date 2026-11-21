// Recently opened projects (most recent first), kept in localStorage.
const KEY = 'testframe.recentProjects';
const MAX = 8;

export const getRecentProjects = (): string[] => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

export const touchRecentProject = (name: string): void => {
  if (!name) return;
  const next = [name, ...getRecentProjects().filter((n) => n !== name)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
};

export const forgetRecentProject = (name: string): void => {
  localStorage.setItem(KEY, JSON.stringify(getRecentProjects().filter((n) => n !== name)));
};

// The selected project lives in the URL (?project=name); none selected = project picker
export const projectFromUrl = (): string | null => new URLSearchParams(window.location.search).get('project');

export const setProjectInUrl = (name: string | null, replace = false): void => {
  const url = new URL(window.location.href);
  if (name) url.searchParams.set('project', name);
  else url.searchParams.delete('project');
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
};
