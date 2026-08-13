interface ImportMetaEnv {
  readonly [key: string]: string | boolean | undefined;
  readonly DEV?: boolean;
  readonly MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: {
    accept: (...args: any[]) => void;
    dispose: (callback: (...args: any[]) => void) => void;
    on: (event: string, callback: (...args: any[]) => void) => void;
  };
}

interface Window {
  google?: any;
}
