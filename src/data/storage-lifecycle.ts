export const STORAGE_LIFECYCLE_CHANNEL =
  "k1frx-morse-trainer-storage-lifecycle-v1";

export type StorageLifecycleEvent = {
  type: "upgrade-blocked" | "connection-closed-for-upgrade";
  databaseName: string;
  emittedAt: string;
  sourceTabId: string;
};

export type StorageLifecycleSubscriber = (event: StorageLifecycleEvent) => void;

export type LifecycleChannel = {
  postMessage: (message: unknown) => void;
  close?: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

export type LifecycleChannelFactory = (name: string) => LifecycleChannel;

function isStorageLifecycleEvent(
  value: unknown,
): value is StorageLifecycleEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<StorageLifecycleEvent>;
  return (
    (event.type === "upgrade-blocked" ||
      event.type === "connection-closed-for-upgrade") &&
    typeof event.databaseName === "string" &&
    typeof event.emittedAt === "string" &&
    typeof event.sourceTabId === "string"
  );
}

export function createLifecycleTabId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `tab-${Math.random().toString(36).slice(2)}`;
}

function hasBroadcastChannel(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.BroadcastChannel !== "undefined"
  );
}

export function defaultLifecycleChannelFactory(name: string): LifecycleChannel {
  return new BroadcastChannel(name) as unknown as LifecycleChannel;
}

export function openLifecycleChannel(
  factory?: LifecycleChannelFactory,
): LifecycleChannel | undefined {
  if (factory) {
    return factory(STORAGE_LIFECYCLE_CHANNEL);
  }
  if (!hasBroadcastChannel()) {
    return undefined;
  }
  return defaultLifecycleChannelFactory(STORAGE_LIFECYCLE_CHANNEL);
}

export function publishStorageLifecycleEvent(
  event: StorageLifecycleEvent,
  factory?: LifecycleChannelFactory,
): void {
  const channel = openLifecycleChannel(factory);
  if (!channel) return;
  try {
    channel.postMessage(event);
  } finally {
    channel.close?.();
  }
}

export function subscribeStorageLifecycleEvents(
  subscriber: StorageLifecycleSubscriber,
  factory?: LifecycleChannelFactory,
): () => void {
  const channel = openLifecycleChannel(factory);
  if (!channel) {
    return () => undefined;
  }

  channel.onmessage = (event) => {
    if (isStorageLifecycleEvent(event.data)) {
      subscriber(event.data);
    }
  };

  return () => {
    channel.onmessage = null;
    channel.close?.();
  };
}
