import {
  Dialect,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
} from "kysely";

import { MysqlReplicaDriverConfig, ReplicaDriver } from "../driver";

type MysqlReplicaDialectConfig = Omit<MysqlReplicaDriverConfig, "type">;

export class MysqlReplicaDialect implements Dialect {
  #config: MysqlReplicaDialectConfig;
  constructor(config: MysqlReplicaDialectConfig) {
    this.#config = config;
  }
  createAdapter() {
    return new MysqlAdapter();
  }
  createDriver() {
    return new ReplicaDriver({
      ...this.#config,
      type: "mysql",
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIntrospector(db: Kysely<any>) {
    return new MysqlIntrospector(db);
  }
  createQueryCompiler() {
    return new MysqlQueryCompiler();
  }
}
