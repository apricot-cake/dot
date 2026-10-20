declare module 'virtual:dot-extension-notifications' {
  export interface ExtensionNotificationController {
    start(count: number): void;
    complete(): void;
    fail(): void;
    clear(): void;
    dispose(): void;
  }

  export function createExtensionNotificationPreview(onSavingChange: (saving: boolean) => void): Promise<ExtensionNotificationController>;
}
