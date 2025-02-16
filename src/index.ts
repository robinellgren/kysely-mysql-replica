import {
  DatabaseConnection,
  Dialect,
  Driver,
  Kysely,
  MysqlAdapter,
  MysqlDialectConfig,
  MysqlDriver,
  MysqlIntrospector,
  MysqlPool,
  MysqlQueryCompiler,
  SelectQueryNode,
  TransactionSettings,
} from "kysely";

// Unfortunately, Kysely does not export the class needed for release connection. So we need to extract it so we cast to it later :/
type MysqlConnection = Parameters<MysqlDriver["releaseConnection"]>[0];

interface MysqlReplicaDBConnection extends DatabaseConnection {
  replicaConnection: {
    getConnectionId: () => string;
    getWriteConnection: () => DatabaseConnection;
    release: () => Promise<void>;
  };
}

type MysqlReplicaDialectConfig = MysqlReplicaDialectConfigBase & {
  pools: { read: Pool; write: Pool };
};

type MysqlReplicaDialectConfigBase = Omit<MysqlDialectConfig, "pool">;

type Pool = (() => Promise<MysqlPool>) | MysqlPool;

class MysqlReplicaDriver implements Driver {
  #config: MysqlReplicaDialectConfig;
  #mysqlReadDriver: MysqlDriver;
  #mysqlWriteDriver: MysqlDriver;
  #transactions: Set<string> = new Set();

  constructor(config: MysqlReplicaDialectConfig) {
    this.#mysqlReadDriver = new MysqlDriver({
      ...config,
      pool: config.pools.read,
    });
    this.#mysqlWriteDriver = new MysqlDriver({
      ...config,
      pool: config.pools.write,
    });
    this.#config = config;
  }

  async acquireConnection(): Promise<MysqlReplicaDBConnection> {
    const [readConnection, writeConnection] = await Promise.all([
      this.#mysqlReadDriver.acquireConnection(),
      this.#mysqlWriteDriver!.acquireConnection(),
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
          await this.#mysqlWriteDriver!.releaseConnection(
            writeConnection as MysqlConnection,
          );
          await this.#mysqlReadDriver!.releaseConnection(
            readConnection as MysqlConnection,
          );
        },
      },
      streamQuery: (...args) => readConnection.streamQuery(...args), // Streaming is always done via read
    };
  }

  beginTransaction(
    connection: MysqlReplicaDBConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    this.#transactions.add(connection.replicaConnection.getConnectionId());
    const writeConnection = connection.replicaConnection.getWriteConnection();
    return this.#mysqlWriteDriver!.beginTransaction(writeConnection, settings);
  }

  commitTransaction(connection: MysqlReplicaDBConnection): Promise<void> {
    const writeConnection = connection.replicaConnection.getWriteConnection();
    this.#transactions.delete(connection.replicaConnection.getConnectionId());
    return this.#mysqlWriteDriver!.commitTransaction(writeConnection);
  }

  async destroy(): Promise<void> {
    // if the same pool is passed in config, we are essentially destroying it twice which will fail so we need to adjust for that.
    if (this.#config.pools?.read === this.#config.pools?.write) {
      await this.#mysqlWriteDriver!.destroy();
      return;
    }
    await this.#mysqlWriteDriver!.destroy();
    await this.#mysqlReadDriver!.destroy();
    return;
  }

  async init(): Promise<void> {
    await this.#mysqlReadDriver!.init();
    await this.#mysqlWriteDriver!.init();
  }

  async releaseConnection(connection: MysqlReplicaDBConnection): Promise<void> {
    await connection.replicaConnection.release();
  }

  rollbackTransaction(connection: MysqlReplicaDBConnection): Promise<void> {
    const writeConnection = connection.replicaConnection.getWriteConnection();
    this.#transactions.delete(connection.replicaConnection.getConnectionId());
    return this.#mysqlWriteDriver!.rollbackTransaction(writeConnection);
  }
}

export class MysqlReplicaDialect implements Dialect {
  #config: MysqlReplicaDialectConfig;
  constructor(config: MysqlReplicaDialectConfig) {
    this.#config = config;
  }
  createAdapter() {
    return new MysqlAdapter();
  }
  createDriver() {
    return new MysqlReplicaDriver(this.#config);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIntrospector(db: Kysely<any>) {
    return new MysqlIntrospector(db);
  }
  createQueryCompiler() {
    return new MysqlQueryCompiler();
  }
}
