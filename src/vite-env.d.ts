/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `local` runs the app on in-browser sample data with no backend. */
  readonly VITE_DATA?: 'local';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
