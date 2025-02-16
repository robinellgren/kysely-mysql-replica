import {
  DatabaseConnection,
  Dialect,
  Driver,
  MysqlDialect,
  MysqlDialectConfig,
  MysqlDriver,
  MysqlPool,
  SelectQueryNode,
  TransactionSettings,
} from "kysely";

// Unfortunately, Kysely does not export the class needed for release connection. So we need to extract it so we cast to it later :/
type MysqlConnection = Parameters<MysqlDriver["releaseConnection"]>[0];

interface MysqlReplicaDBConnection extends DatabaseConnection {
  replicaConnection?: {
    getConnectionId: () => string;
    getWriteConnection: () => DatabaseConnection;
    release: () => Promise<void>;
  };
}

type MysqlReplicaDialectConfig =
  | (MysqlReplicaDialectConfigBase & {
      pool: (() => Promise<MysqlPool>) | MysqlPool;
      pools?: never;
    })
  | (MysqlReplicaDialectConfigBase & {
      pool?: never;
      pools: { read: MysqlPool; write: MysqlPool };
    });

type MysqlReplicaDialectConfigBase = Omit<MysqlDialectConfig, "pool">;

class MysqlReplicaDriver extends MysqlDriver implements Driver {
  #config: MysqlReplicaDialectConfig;
  #mysqlReadDriver?: MysqlDriver;
  #mysqlWriteDriver?: MysqlDriver;
  #transactions: Set<string> = new Set();

  constructor(config: MysqlReplicaDialectConfig) {
    super({ ...config, pool: config.pool ?? config.pools.write });

    if (config.pools) {
      const baseConfig = { ...config, pools: undefined };
      this.#mysqlReadDriver = new MysqlDriver({
        ...baseConfig,
        pool: config.pools.read,
      });
      this.#mysqlWriteDriver = new MysqlDriver({
        ...baseConfig,
        pool: config.pools.write,
      });
    }
    this.#config = config;
  }

  override async acquireConnection(): Promise<MysqlReplicaDBConnection> {
    if (!this.#mysqlReadDriver) {
      return super.acquireConnection();
    }
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

  override beginTransaction(
    connection: MysqlReplicaDBConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    if (connection.replicaConnection) {
      this.#transactions.add(connection.replicaConnection.getConnectionId());
      const writeConnection = connection.replicaConnection.getWriteConnection();
      return this.#mysqlWriteDriver!.beginTransaction(writeConnection, settings);
    }
    return super.beginTransaction(connection, settings);
  }

  override commitTransaction(connection: MysqlReplicaDBConnection): Promise<void> {
    if (connection.replicaConnection) {
      const writeConnection = connection.replicaConnection.getWriteConnection();
      this.#transactions.delete(connection.replicaConnection.getConnectionId());
      return this.#mysqlWriteDriver!.commitTransaction(writeConnection);
    }
    return super.commitTransaction(connection);
  }

  override async destroy(): Promise<void> {
    if (!this.#mysqlReadDriver) {
      await super.destroy();
      return;
    }
    // if the same pool is passed in config, we are essentially destroying it twice which will fail so we need to adjust for that.
    if (this.#config.pools?.read === this.#config.pools?.write) {
      await this.#mysqlWriteDriver!.destroy();
      return;
    }
    await this.#mysqlWriteDriver!.destroy();
    await this.#mysqlReadDriver!.destroy();
    return;
  }

  override async init(): Promise<void> {
    if (!this.#mysqlReadDriver) {
      await super.init();
      return;
    }
    await this.#mysqlReadDriver!.init();
    await this.#mysqlWriteDriver!.init();
  }

  override async releaseConnection(
    connection: MysqlReplicaDBConnection,
  ): Promise<void> {
    if (connection.replicaConnection) {
      await connection.replicaConnection.release();
      return;
    }
    await super.releaseConnection(connection as MysqlConnection);
  }

  override rollbackTransaction(connection: MysqlReplicaDBConnection): Promise<void> {
    if (connection.replicaConnection) {
      const writeConnection = connection.replicaConnection.getWriteConnection();
      this.#transactions.delete(connection.replicaConnection.getConnectionId());
      return this.#mysqlWriteDriver!.rollbackTransaction(writeConnection);
    }
    return super.rollbackTransaction(connection);
  }
}

export class MysqlReplicaDialect extends MysqlDialect implements Dialect {
  #config: MysqlReplicaDialectConfig;
  constructor(config: MysqlReplicaDialectConfig) {
    super({ ...config, pool: config.pool ?? config.pools.write });
    this.#config = config;
  }

  override createDriver(): Driver {
    return new MysqlReplicaDriver(this.#config as MysqlReplicaDialectConfig);
  }
}
