'use client';

import { useEffect, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { EditorApp } from './editor-app';
import { useI18n } from './i18n';
import { ProjectPicker } from './project-picker';
import { projectFromUrl, setProjectInUrl } from './recent-projects';

/**
 * The editor's entry point. The project comes from the URL (`?project=name`); without one the
 * start screen lists the projects under TESTFRAME_PROJECTS_ROOT. The URL is read after mount so
 * the server render and the first client render agree (no hydration mismatch).
 */
export function EditorRoot() {
  const { t } = useI18n();
  const [project, setProject] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProject(projectFromUrl());
    setReady(true);
    const onPopState = () => setProject(projectFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const open = (name: string | null) => {
    setProjectInUrl(name);
    setProject(name);
  };

  if (!ready) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 bg-[#F5F5F7] text-slate-500">
        <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
          <Layers className="w-6 h-6" />
        </div>
        <p className="text-xs font-medium flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('loading')}
        </p>
      </div>
    );
  }

  // key: switching projects remounts the editor, so no state of the previous one leaks in
  return project ? <EditorApp key={project} project={project} onSwitchProject={() => open(null)} /> : <ProjectPicker onOpen={open} />;
}
