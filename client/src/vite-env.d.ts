/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROJECT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
