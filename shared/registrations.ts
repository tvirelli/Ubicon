// Shared shape for the two dynamically-registered content scripts Ubicon
// needs on every local-controller origin the user grants: the isolated-world
// painter (content.js) and the MAIN-world React props bridge (bridge.js).
// Used by both entrypoints/background.ts (re-registration after a browser
// restart/extension update) and entrypoints/options/main.ts (registration
// when the user adds an origin) so the two stay in lockstep.

export const bridgeIdFor = (hostname: string) => 'ubicon-bridge-' + hostname;
export const paintIdFor = (hostname: string) => 'ubicon-' + hostname;

export function registrationsForOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  const matches = [origin + '/*'];
  return [
    {
      id: paintIdFor(hostname),
      matches,
      js: ['content-scripts/content.js'],
      runAt: 'document_idle' as const,
      persistAcrossSessions: true,
    },
    {
      id: bridgeIdFor(hostname),
      matches,
      js: ['content-scripts/bridge.js'],
      world: 'MAIN' as const,
      runAt: 'document_idle' as const,
      persistAcrossSessions: true,
    },
  ];
}
