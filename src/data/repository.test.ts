import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { SCHEMA_V1, TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";

describe("DexieTrainingRepository", () => {
  it("creates stable schema metadata once during bootstrap", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });
    let idCalls = 0;
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T18:00:00.000Z"),
      createId: () => {
        idCalls += 1;
        return "dataset-generation-1";
      },
    });

    try {
      const first = await repository.open();
      const second = await repository.open();

      expect(first).toEqual({
        id: "schema-metadata",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        databaseVersion: 2,
        datasetGeneration: "dataset-generation-1",
      });
      expect(second).toEqual(first);
      expect(idCalls).toBe(1);
      expect(await database.metadata.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("reconciles version 1 metadata while preserving its dataset generation", async () => {
    const name = crypto.randomUUID();
    const version1 = new Dexie(name, { indexedDB, IDBKeyRange });
    version1.version(1).stores(SCHEMA_V1);
    await version1.open();
    await version1.table("metadata").add({
      id: "schema-metadata",
      schemaVersion: 1,
      updatedAt: "2026-09-23T18:00:00.000Z",
      databaseVersion: 1,
      datasetGeneration: "existing-generation",
    });
    version1.close();

    const database = new TrainerDatabase({
      name,
      indexedDB,
      IDBKeyRange,
    });
    let idCalls = 0;
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T18:00:00.000Z"),
      createId: () => {
        idCalls += 1;
        return "replacement-generation";
      },
    });

    try {
      const metadata = await repository.open();

      expect(metadata).toEqual({
        id: "schema-metadata",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        databaseVersion: 2,
        datasetGeneration: "existing-generation",
      });
      expect(await database.metadata.get("schema-metadata")).toEqual(metadata);
      expect(idCalls).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rebuilds projection tables instead of trusting existing rows", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      createId: () => "dataset-generation-1",
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });

    try {
      await repository.open();
      await database.dailyProjections.put({
        id: "daily:stale",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        projectionVersion: 1,
        localDate: "stale",
        activeMs: 1,
        sessionCount: 1,
        attemptCount: 1,
        rxCorrect: 1,
        rxTotal: 1,
        txCorrect: 0,
        txTotal: 0,
        effectiveWpmTotal: 12,
        effectiveWpmSamples: 1,
      });

      await repository.rebuildProjections();

      expect(await database.dailyProjections.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
