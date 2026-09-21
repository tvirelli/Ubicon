// Every change to assignments runs through this queue, one at a time. Outside
// browser mode all assignments live under a single storage.local key, so each
// change is a read-modify-write of the whole set: two running at once (say,
// several quick clicks in the popup, or the popup and a sync pull) would each
// read the old set and the last writer would silently drop the other's change.
// This is also why the popup sends 'unassign' and 'import' to the background
// worker instead of calling shared/storage.ts itself: one queue only works if
// there is one writer, and the background worker is it.
let writeQueue: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {}); // a failed change must not wedge the queue
  return run;
}
