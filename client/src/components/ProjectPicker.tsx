import React from 'react';
import { Clock, FolderOpen, Layers, Loader2, Plus, X } from 'lucide-react';
import { testframeApi, type ProjectSummary } from '../client-api';
import { slug } from '../frames';
import { useI18n } from '../i18n';
import { forgetRecentProject, getRecentProjects } from '../recent-projects';

interface ProjectPickerProps {
  onOpen: (name: string) => void;
  suggested?: string; // project the runner was started with (VITE_PROJECT)
}

// ============================================================================
// START SCREEN: shown when no project is selected (no ?project= in the URL)
// ============================================================================
export function ProjectPicker({ onOpen, suggested }: ProjectPickerProps) {
  const { t, lang, setLang } = useI18n();
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<string[]>(getRecentProjects);
  const [newName, setNewName] = React.useState('');

  React.useEffect(() => {
    testframeApi
      .listProjects()
      .then(setProjects)
      .catch((err: Error) => {
        setProjects([]);
        setError(err.message);
      });
  }, []);

  const byName = new Map((projects ?? []).map((p) => [p.name, p]));
  const others = (projects ?? []).filter((p) => !recent.includes(p.name));
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(lang) : '');

  const row = (name: string, info?: ProjectSummary, removable = false) => (
    <li key={name} className="group flex items-center gap-2">
      <button
        onClick={() => onOpen(name)}
        className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-sm text-left transition-all"
      >
        <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
          <Layers className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 truncate">{name}</span>
            {name === suggested && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                {t('projectSuggested')}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500">
            {info
              ? t('projectStats', { frames: info.frames, sources: info.sources, when: when(info.lastModified) })
              : t('projectNotOnDisk')}
          </span>
        </div>
      </button>
      {removable && (
        <button
          onClick={() => {
            forgetRecentProject(name);
            setRecent(getRecentProjects());
          }}
          title={t('projectForget')}
          className="p-1.5 rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );

  return (
    <div className="h-screen w-screen overflow-auto bg-[#F5F5F7] text-slate-800 font-sans">
      <div className="max-w-2xl mx-auto px-6 py-12 space-y-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">TestFrame</h1>
              <p className="text-xs text-slate-500">{t('pickProjectHint')}</p>
            </div>
          </div>
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-[11px] font-semibold">
            {(['en', 'pt-BR'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-1 rounded-md ${lang === l ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'}`}
              >
                {l === 'en' ? 'EN' : 'PT'}
              </button>
            ))}
          </div>
        </header>

        {recent.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t('recentProjects')}
            </h2>
            <ul className="space-y-1.5">{recent.map((name) => row(name, byName.get(name), true))}</ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            {recent.length ? t('otherProjects') : t('allProjects')}
          </h2>
          {projects === null ? (
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('loadingProjects')}
            </p>
          ) : error ? (
            <p className="text-xs text-rose-600">{t('projectsLoadFail', { msg: error })}</p>
          ) : others.length ? (
            <ul className="space-y-1.5">{others.map((p) => row(p.name, p))}</ul>
          ) : (
            <p className="text-xs text-slate-400">{t('noMoreProjects')}</p>
          )}
        </section>

        <form
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            const name = slug(newName);
            if (newName.trim()) onOpen(name);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('newProjectPlaceholder')}
            className="flex-1 text-sm bg-white border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            {t('createProject')}
          </button>
        </form>
      </div>
    </div>
  );
}
