'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TourApp, type Lang } from '@testframe/tour-ui';

/** The editor's language key (editor/i18n.tsx), so the tour opens in the language the IDE uses. */
const LANG_KEY = 'testframe.lang';

/**
 * The test tour, hosted by the IDE (agents/specs/test-tour.md). The editor saves the project before
 * opening this page; from here every tour API call goes through the IDE's own `/api/tour/*` proxy
 * to the plugin, so the browser talks to one origin only and never receives a secret. The screens,
 * the tour state and the PDF are the same `@testframe/tour-ui` the plugin serves at `/tour`.
 */
function Tour() {
  const params = useSearchParams();
  const router = useRouter();
  const project = params.get('project');
  // Read after mount so the server render and the first client render agree.
  const [lang, setLang] = useState<Lang | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(LANG_KEY);
    setLang(stored === 'pt-BR' ? 'pt-BR' : 'en');
  }, []);

  if (!lang) return null;

  return (
    <TourApp
      apiBase="/api/tour"
      lang={lang}
      project={project}
      environment={params.get('env')}
      onExit={() => router.push(project ? `/?project=${encodeURIComponent(project)}` : '/')}
    />
  );
}

export default function TourPage() {
  // useSearchParams() needs a Suspense boundary above it in the App Router.
  return (
    <Suspense fallback={null}>
      <Tour />
    </Suspense>
  );
}
