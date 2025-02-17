import {
  DatabaseConnection,
  Driver,
  MysqlDialectConfig,
  MysqlDriver,
  PostgresDialectConfig,
  PostgresDriver,
  SelectQueryNode,
  TransactionSettings,
} from "kysely";

export type MysqlReplicaDriverConfig = Omit<MysqlDialectConfig, "pool"> & {
  pools: { read: MysqlPool; write: MysqlPool };
  type: "mysql";
};
export type PostgresReplicaDriverConfig = Omit<PostgresDialectConfig, "pool"> & {
  pools: { read: PostgresPool; write: PostgresPool };
  type: "pg";
};

type MysqlPool = MysqlDialectConfig["pool"];
type PostgresPool = PostgresDialectConfig["pool"];

interface ReplicaDatabaseConnection extends DatabaseConnection {
  replicaConnection: {
    getConnectionId: () => string;
    getWriteConnection: () => DatabaseConnection;
    release: () => Promise<void>;
  };
}

type ReplicaDriverConfig = MysqlReplicaDriverConfig | PostgresReplicaDriverConfig;

export class ReplicaDriver implements Driver {
  #config: ReplicaDriverConfig;
  #readDriver: Driver;
  #transactions: Set<string> = new Set();
  #writeDriver: Driver;

  constructor(config: ReplicaDriverConfig) {
    const { pools, type, ...dialectConfig } = config;
    switch (type) {
      case "mysql":
        this.#readDriver = new MysqlDriver({ ...dialectConfig, pool: pools.read });
        this.#writeDriver = new MysqlDriver({ ...dialectConfig, pool: pools.write });
        break;
      case "pg":
        this.#readDriver = new PostgresDriver({ ...dialectConfig, pool: pools.read });
        this.#writeDriver = new PostgresDriver({ ...dialectConfig, pool: pools.write });
        break;
      default:
        throw new Error("Only MySQL and Postgres are supported");
    }
    this.#config = config;
  }

  async acquireConnection(): Promise<ReplicaDatabaseConnection> {
    const [readConnection, writeConnection] = await Promise.all([
      this.#readDriver.acquireConnection(),
      this.#writeDriver.acquireConnection(),
    ]);
    const connectionId = crypto.randomUUID();
    return {
      executeQuery: async (compiledQuery) => {
        if (this.#transactions.has(connectionId)) {
          return writeConnection.executeQuery(compiledQuery);
        }
        return SelectQueryNode.is(compiledQuery.query)
          ? readConnection.executeQuery(compiledQuery)
          : writeConnection.executeQuery(compiledQuery);
      },
      replicaConnection: {
        getConnectionId: () => connectionId,
        getWriteConnection: () => writeConnection,
        release: async () => {
          await this.#writeDriver.releaseConnection(writeConnection);
          await this.#readDriver.releaseConnection(readConnection);
        },
      },
      streamQuery: (...args) => {
        if (this.#transactions.has(connectionId)) {
          return writeConnection.streamQuery(...args);
        }
        const [compiledQuery] = args;
        return SelectQueryNode.is(compiledQuery.query)
          ? readConnection.streamQuery(...args)
          : writeConnection.streamQuery(...args);
      },
    };
  }

  beginTransaction(
    connection: ReplicaDatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    this.#transactions.add(connection.replicaConnection.getConnectionId());
    const writeConnection = connection.replicaConnection.getWriteConnection();
    return this.#writeDriver.beginTransaction(writeConnection, settings);
  }

  commitTransaction(connection: ReplicaDatabaseConnection): Promise<void> {
    const writeConnection = connection.replicaConnection.getWriteConnection();
    this.#transactions.delete(connection.replicaConnection.getConnectionId());
    return this.#writeDriver.commitTransaction(writeConnection);
  }

  async destroy(): Promise<void> {
    console.log("CALLED THE THINGY!!");
    // if the same pool is passed in config, we are essentially destroying it twice which will fail so we need to adjust for that.
    if (this.#config.pools.read === this.#config.pools.write) {
      console.log("SAME POOL!!!");
      await this.#writeDriver.destroy();
      return;
    }
    await this.#writeDriver.destroy();
    await this.#readDriver.destroy();
    return;
  }

  async init(): Promise<void> {
    await this.#readDriver.init();
    await this.#writeDriver.init();
  }

  async releaseConnection(connection: ReplicaDatabaseConnection): Promise<void> {
    await connection.replicaConnection.release();
  }

  rollbackTransaction(connection: ReplicaDatabaseConnection): Promise<void> {
    const writeConnection = connection.replicaConnection.getWriteConnection();
    this.#transactions.delete(connection.replicaConnection.getConnectionId());
    return this.#writeDriver.rollbackTransaction(writeConnection);
  }
}
