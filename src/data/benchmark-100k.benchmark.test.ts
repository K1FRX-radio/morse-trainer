import { performance } from "node:perf_hooks";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";
import { buildBenchmarkFixture } from "./benchmark-100k-fixture.ts";

type BenchmarkSample = {
  sourceBytes: number;
  projectionBytes: number;
  backupBytes: number;
  rebuildMs: number;
  dailyQueryMs: number;
  aggregateQueryMs: number;
  rxQueryMs: number;
  txQueryMs: number;
  confusionQueryMs: number;
  exportMs: number;
};

function encodeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function runBenchmark(): Promise<BenchmarkSample> {
  const fixture = buildBenchmarkFixture();

  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database, {
    now: () => new Date("2026-10-03T00:00:00.000Z"),
  });

  try {
    await repository.open();
    await repository.savePortableSettings(DEFAULT_SETTINGS);
    await repository.saveCurriculumState(
      createInitialState(DEFAULT_CURRICULUM_CONFIG),
    );
    await repository.saveIntroductions([
      "K",
      "M",
      "R",
      "S",
      "U",
      "A",
      "N",
      "T",
    ]);
    await database.sessions.bulkPut(fixture.sessions);
    await database.attempts.bulkPut(fixture.attempts);

    const rebuildStart = performance.now();
    await repository.rebuildProjections();
    const rebuildMs = performance.now() - rebuildStart;

    const dailyStart = performance.now();
    await repository.listDailyProjections({
      fromLocalDate: "2026-09-01",
      toLocalDate: "2027-03-31",
      limit: 500,
    });
    const dailyQueryMs = performance.now() - dailyStart;

    const aggregateStart = performance.now();
    await repository.getDashboardAggregate({ toLocalDate: "2027-03-31" });
    const aggregateQueryMs = performance.now() - aggregateStart;

    const rxStart = performance.now();
    await repository.listCharacterProjections({ direction: "rx", limit: 200 });
    const rxQueryMs = performance.now() - rxStart;

    const txStart = performance.now();
    await repository.listCharacterProjections({ direction: "tx", limit: 200 });
    const txQueryMs = performance.now() - txStart;

    const confusionStart = performance.now();
    await repository.listConfusionProjections({ limit: 50 });
    const confusionQueryMs = performance.now() - confusionStart;

    const exportStart = performance.now();
    const backup = await repository.exportPortableBackup("0.0.0");
    const exportMs = performance.now() - exportStart;

    const sourceBytes =
      encodeBytes(await database.sessions.toArray()) +
      encodeBytes(await database.attempts.toArray());
    const projectionBytes =
      encodeBytes(await database.dailyProjections.toArray()) +
      encodeBytes(await database.characterProjections.toArray()) +
      encodeBytes(await database.confusionProjections.toArray());

    return {
      sourceBytes,
      projectionBytes,
      backupBytes: encodeBytes(backup),
      rebuildMs,
      dailyQueryMs,
      aggregateQueryMs,
      rxQueryMs,
      txQueryMs,
      confusionQueryMs,
      exportMs,
    };
  } finally {
    repository.close();
    await database.delete();
  }
}

describe("100k history benchmark", () => {
  it("keeps bounded queries and export generation within budget on 100k mixed RX/TX history", async () => {
    const sample = await runBenchmark();
    console.info("100k-benchmark", JSON.stringify(sample));

    const budget = {
      queryMs: 500,
      exportMs: 5000,
    };

    expect(sample.dailyQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.aggregateQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.rxQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.txQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.confusionQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.exportMs).toBeLessThanOrEqual(budget.exportMs);

    expect(sample.sourceBytes).toBeGreaterThan(0);
    expect(sample.projectionBytes).toBeGreaterThan(0);
    expect(sample.backupBytes).toBeGreaterThan(0);
  }, 90_000);
});
