declare module 'screenshot-desktop' {
  interface Display {
    id: number | string;
    name?: string;
  }

  interface ScreenshotOptions {
    screen?: number | string;
    format?: 'png' | 'jpg';
    filename?: string;
  }

  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;

  namespace screenshot {
    function listDisplays(): Promise<Display[]>;
    function all(): Promise<Buffer[]>;
  }

  export = screenshot;
}
