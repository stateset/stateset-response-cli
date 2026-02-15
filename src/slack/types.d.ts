// Ambient declaration so TypeScript doesn't error on the dynamic import.
// @slack/bolt is an optional dependency loaded at runtime.
declare module '@slack/bolt' {
  export class App {
    constructor(opts: Record<string, unknown>);
    client: {
      auth: { test: (opts: { token: string }) => Promise<{ user_id?: string }> };
      chat: { postMessage: (opts: Record<string, unknown>) => Promise<unknown> };
    };
    message(handler: (args: { event: Record<string, unknown> }) => Promise<void>): void;
    action(
      pattern: RegExp,
      handler: (args: {
        action: Record<string, unknown>;
        body: Record<string, unknown>;
        ack: () => Promise<void>;
        respond: (msg: Record<string, unknown>) => Promise<void>;
      }) => Promise<void>,
    ): void;
    start(): Promise<void>;
    stop(): Promise<void>;
  }
}
