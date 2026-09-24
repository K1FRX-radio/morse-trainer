import { DATABASE_VERSION, TrainerDatabase } from "./indexeddb.ts";
import { RECORD_SCHEMA_VERSION, type SchemaMetadataRecord } from "./models.ts";
import { buildProjectionRows } from "./projections.ts";
import { parseTrainingAttempts, parseTrainingSessions } from "./validation.ts";

export type RepositoryDependencies = {
  now?: () => Date;
  createId?: () => string;
};

export interface TrainingDataRepository {
  open(): Promise<SchemaMetadataRecord>;
  close(): void;
  rebuildProjections(): Promise<void>;
}

function defaultId(): string {
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    throw new Error("secure UUID generation is unavailable");
  }
  return crypto.randomUUID();
}

export class DexieTrainingRepository implements TrainingDataRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    readonly database: TrainerDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? defaultId;
  }

  async open(): Promise<SchemaMetadataRecord> {
    await this.database.open();
    return this.database.transaction("rw", this.database.metadata, async () => {
      const existing = await this.database.metadata.get("schema-metadata");
      if (existing && "databaseVersion" in existing) return existing;

      const updatedAt = this.now().toISOString();
      const metadata: SchemaMetadataRecord = {
        id: "schema-metadata",
        schemaVersion: RECORD_SCHEMA_VERSION,
        updatedAt,
        databaseVersion: DATABASE_VERSION,
        datasetGeneration: this.createId(),
      };
      await this.database.metadata.put(metadata);
      return metadata;
    });
  }

  close(): void {
    this.database.close();
  }

  async rebuildProjections(): Promise<void> {
    const generatedAt = this.now().toISOString();
    await this.database.transaction(
      "rw",
      this.database.sessions,
      this.database.attempts,
      this.database.dailyProjections,
      this.database.characterProjections,
      this.database.confusionProjections,
      async () => {
        const sessions = parseTrainingSessions(
          await this.database.sessions.toArray(),
        );
        const attempts = parseTrainingAttempts(
          await this.database.attempts.toArray(),
        );
        const rows = buildProjectionRows(sessions, attempts, generatedAt);

        await this.database.dailyProjections.clear();
        await this.database.characterProjections.clear();
        await this.database.confusionProjections.clear();
        await this.database.dailyProjections.bulkPut(rows.daily);
        await this.database.characterProjections.bulkPut(rows.characters);
        await this.database.confusionProjections.bulkPut(rows.confusions);
      },
    );
  }
}
