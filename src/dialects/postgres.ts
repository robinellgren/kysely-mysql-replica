import {
  Dialect,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

import { PostgresReplicaDriverConfig, ReplicaDriver } from "../driver";

type PostgresReplicaDialectConfig = Omit<PostgresReplicaDriverConfig, "type">;

export class PostgresReplicaDialect implements Dialect {
  #config: PostgresReplicaDialectConfig;
  constructor(config: PostgresReplicaDialectConfig) {
    this.#config = config;
  }
  createAdapter() {
    return new PostgresAdapter();
  }
  createDriver() {
    return new ReplicaDriver({
      ...this.#config,
      type: "pg",
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIntrospector(db: Kysely<any>) {
    return new PostgresIntrospector(db);
  }
  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}
