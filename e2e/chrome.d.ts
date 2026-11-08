// Minimal typing for the extension APIs the e2e lane drives in-page.
// @types/chrome is deliberately not a dependency: only these members are used.
declare const chrome:
  | {
      permissions?: {
        contains(details: { origins: string[] }): Promise<boolean>;
        request(details: { origins: string[] }): Promise<boolean>;
      };
    }
  | undefined;
