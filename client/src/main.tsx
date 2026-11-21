import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ProjectPicker } from './components/ProjectPicker'
import { I18nProvider } from './i18n'
import { projectFromUrl, setProjectInUrl } from './recent-projects'

// The project comes from the URL (?project=name); without one, the start screen lists projects
function Root() {
  const [project, setProject] = useState<string | null>(projectFromUrl)

  useEffect(() => {
    const onPop = () => setProject(projectFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const open = (name: string | null) => {
    setProjectInUrl(name)
    setProject(name)
  }

  return project ? (
    <App key={project} project={project} onSwitchProject={() => open(null)} />
  ) : (
    <ProjectPicker onOpen={open} suggested={import.meta.env.VITE_PROJECT} />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Root />
    </I18nProvider>
  </StrictMode>,
)
