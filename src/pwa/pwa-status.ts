export type PwaStatusSnapshot = {
  offlineReady: boolean;
  updateReady: boolean;
};

type ActivateUpdate = () => Promise<void>;
type Listener = (snapshot: PwaStatusSnapshot) => void;

let snapshot: PwaStatusSnapshot = {
  offlineReady: false,
  updateReady: false,
};
let activateUpdate: ActivateUpdate | undefined;
const listeners = new Set<Listener>();

function notify(): void {
  const current = { ...snapshot };
  for (const listener of listeners) {
    listener(current);
  }
}

export function subscribePwaStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...snapshot });
  return () => {
    listeners.delete(listener);
  };
}

export function markPwaOfflineReady(): void {
  if (snapshot.offlineReady) return;
  snapshot = { ...snapshot, offlineReady: true };
  notify();
}

export function markPwaUpdateReady(update: ActivateUpdate): void {
  activateUpdate = update;
  snapshot = { ...snapshot, updateReady: true };
  notify();
}

export async function activatePwaUpdate(): Promise<boolean> {
  if (!activateUpdate) return false;
  await activateUpdate();
  activateUpdate = undefined;
  snapshot = { ...snapshot, updateReady: false };
  notify();
  return true;
}

export function resetPwaStatusForTests(): void {
  activateUpdate = undefined;
  snapshot = { offlineReady: false, updateReady: false };
  notify();
}
