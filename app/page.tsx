import { EditorRoot } from '@/editor/editor-root';
import { I18nProvider } from '@/editor/i18n';

/**
 * The IDE editor: the project picker when the URL has no `?project=`, the canvas otherwise.
 * Everything below this page is client-side and talks to the same-origin `/api/v2/*` handlers.
 */
export default function EditorPage() {
  return (
    <I18nProvider>
      <EditorRoot />
    </I18nProvider>
  );
}
