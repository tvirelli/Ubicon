// Shared shape for the two dynamically-registered content scripts Ubicon
// needs on every local-controller origin the user grants: the isolated-world
// painter (content.js) and the MAIN-world React props bridge (bridge.js).
// Used by both entrypoints/background.ts (re-registration after a browser
// restart/extension update) and entrypoints/options/main.ts (registration
// when the user adds an origin) so the two stay in lockstep.

// Script ids are derived from the origin's host (hostname + port, when
// present) rather than just its hostname: two controllers on the same host
// but different ports (e.g. https://10.71.0.1:8443 and https://10.71.0.1:8444)
// are distinct origins and must not collide on a single registered-script id.
// ':' isn't valid in a scripting.RegisteredContentScript id, so it's
// sanitized to '-'.
const idHostOf = (origin: string) => new URL(origin).host.replace(/:/g, '-');

export const bridgeIdFor = (origin: string) => 'ubicon-bridge-' + idHostOf(origin);
export const paintIdFor = (origin: string) => 'ubicon-' + idHostOf(origin);

export function registrationsForOrigin(origin: string) {
  const matches = [origin + '/*'];
  return [
    {
      id: paintIdFor(origin),
      matches,
      js: ['content-scripts/content.js'],
      runAt: 'document_idle' as const,
      persistAcrossSessions: true,
    },
    {
      id: bridgeIdFor(origin),
      matches,
      js: ['content-scripts/bridge.js'],
      world: 'MAIN' as const,
      runAt: 'document_idle' as const,
      persistAcrossSessions: true,
    },
  ];
}
