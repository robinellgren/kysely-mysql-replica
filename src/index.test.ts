import { MySqlContainer, StartedMySqlContainer } from "@testcontainers/mysql";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Generated, Kysely, MysqlDialect, PostgresDialect } from "kysely";
import { createPool } from "mysql2";
import { Pool } from "pg";
import Cursor from "pg-cursor";
import { afterAll, describe, expect, it } from "vitest";

import { MysqlReplicaDialect, PostgresReplicaDialect } from ".";

interface TestDB {
  Pets: {
    firstName: string;
    ownerId: number;
  };
  Users: {
    firstName: string;
    id: Generated<number>;
  };
}

const setupSchema = async (dbClient: Kysely<TestDB>) => {
  await dbClient.schema
    .createTable("Users")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("firstName", "text")
    .execute();
  await dbClient.schema
    .createTable("Pets")
    .addColumn("firstName", "text")
    .addColumn("ownerId", "integer", (col) => col.references("Users.id"))
    .execute();
};

const getPoolFromContainer = (
  container: StartedMySqlContainer | StartedPostgreSqlContainer,
) => {
  const baseConfig = {
    database: container.getDatabase(),
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
  };
  if (container instanceof StartedMySqlContainer) {
    return createPool({
      ...baseConfig,
      password: container.getUserPassword(),
    });
  }
  return new Pool({
    ...baseConfig,
    password: container.getPassword(),
  });
};

const getMySqlContainerWithPoolAndDb = async () => {
  const container = await new MySqlContainer().start();
  const pool = createPool({
    database: container.getDatabase(),
    host: container.getHost(),
    password: container.getUserPassword(),
    port: container.getPort(),
    user: container.getUsername(),
  });
  return {
    container,
    db: new Kysely<TestDB>({ dialect: new MysqlDialect({ pool }) }),
    pool,
  };
};

const getPostgresContainerWithPoolAndDb = async () => {
  const container = await new PostgreSqlContainer().start();
  const pool = new Pool({
    database: container.getDatabase(),
    host: container.getHost(),
    password: container.getPassword(),
    port: container.getPort(),
    user: container.getUsername(),
  });
  return {
    container,
    db: new Kysely<TestDB>({ dialect: new PostgresDialect({ pool }) }),
    pool,
  };
};

describe.sequential.each([
  ["mysql", getMySqlContainerWithPoolAndDb, MysqlReplicaDialect] as const,
  ["pg", getPostgresContainerWithPoolAndDb, PostgresReplicaDialect] as const,
])(
  "database dialect: %s",
  async (_dbType, getContainerWithPoolAndDb, ReplicaDialect) => {
    const {
      container: readContainer,
      db: readDb,
      pool: readPool,
    } = await getContainerWithPoolAndDb();
    await setupSchema(readDb);
    const {
      container: writeContainer,
      db: writeDb,
      pool: writePool,
    } = await getContainerWithPoolAndDb();
    await setupSchema(writeDb);
    // So write and read pool are now actually different DBs!
    const pools = {
      read: readPool,
      write: writePool,
      // Need to cast as any since the ReplicaDialect can be either Mysql or Postgres
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const cursor = _dbType === "pg" ? Cursor : undefined; // Needed for Postgres to be able to handle streaming
    const dbClient = new Kysely<TestDB>({
      dialect: new ReplicaDialect({ cursor, pools }),
    });
    afterAll(async () => {
      await readContainer.stop();
      await writeContainer.stop();
    });

    it("should be possible to introspect the db", async () => {
      const tables = await dbClient.introspection.getTables();
      const tableNames = tables.map((table) => table.name);
      expect(tableNames).toEqual(["Pets", "Users"]);
    });

    it("should be able switch seamlessly between read and write pool", async () => {
      let insertedUserId = 0;
      // Insert uses write db
      if (_dbType === "mysql") {
        // mysql automatically returns the inserted id
        insertedUserId = Number(
          (
            await dbClient
              .insertInto("Users")
              .values([{ firstName: "robin" }])
              .executeTakeFirst()
          ).insertId,
        );
      } else if (_dbType === "pg") {
        // for pg we need to use "returning" to get the inserted id
        const result = await dbClient
          .insertInto("Users")
          .values([{ firstName: "robin" }])
          .returning("id")
          .executeTakeFirst();
        insertedUserId = result!.id;
      }
      expect(insertedUserId).toBe(1);
      // select query => read pool
      const users = await dbClient.selectFrom("Users").selectAll().execute();
      // because of read instance we get 0 results (remember it's really a different db (see setup!)
      expect(users.length).toBe(0);
    });

    it("should always use write pool within transactions", async () => {
      // from within transactions always the write instance is used
      await dbClient.transaction().execute(async (trx) => {
        let insertedUserId = 0;
        if (_dbType === "mysql") {
          // mysql automatically returns the inserted id
          insertedUserId = Number(
            (
              await dbClient
                .insertInto("Users")
                .values([{ firstName: "batman" }])
                .executeTakeFirstOrThrow()
            ).insertId,
          );
        } else if (_dbType === "pg") {
          // for pg we need to use "returning" to get the inserted id
          const result = await dbClient
            .insertInto("Users")
            .values([{ firstName: "batman" }])
            .returning("id")
            .executeTakeFirstOrThrow();
          insertedUserId = result!.id;
        }
        expect(insertedUserId).toBe(2); // sequentially running so the user from previous test counts!
        const users = await trx
          .selectFrom("Users")
          .where("firstName", "=", "batman")
          .selectAll()
          .execute();
        // because inside transaction we use write db again and then the result works!
        expect(users.length).toBe(1);
      });
    });

    it("should work when write and read is the same pool ", async () => {
      const newPool = getPoolFromContainer(writeContainer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pools = { read: newPool, write: newPool } as any;
      const dbWithSinglePool = new Kysely<TestDB>({
        dialect: new ReplicaDialect({
          pools: pools,
        }),
      });
      // insert first
      await dbWithSinglePool
        .insertInto("Pets")
        .values([{ firstName: "Lassie", ownerId: 2 }])
        .execute();
      // since read and write is the same pool, getting the newly inserted pet works
      const robinsPet = await dbWithSinglePool
        .selectFrom("Pets")
        .selectAll()
        .where("firstName", "=", "Lassie")
        .executeTakeFirst();
      expect(robinsPet?.ownerId).toBe(2);
      const destroyResult = await dbWithSinglePool.destroy();
      expect(destroyResult).toBe(undefined); // i.e. did not throw
      const queryWithDestroyedDbPromise = dbWithSinglePool
        .selectFrom("Pets")
        .selectAll()
        .where("firstName", "=", "Lassie")
        .executeTakeFirst();
      await expect(queryWithDestroyedDbPromise).rejects.toThrowError(
        "driver has already been destroyed",
      );
    });

    it("should work to switch between reader and writer when streaming", async () => {
      const users = [
        { firstName: "Yoda", id: 100 },
        { firstName: "Obi-Wan Kenobi", id: 101 },
      ];
      const stream = // write db being used
        _dbType === "pg"
          ? dbClient.insertInto("Users").values(users).returning("id").stream()
          : dbClient.insertInto("Users").values(users).stream();
      const userIds: number[] = [];
      for await (const result of stream) {
        const userId = "id" in result ? result.id : Number(result.insertId);
        userIds.push(userId);
      }
      if (_dbType === "mysql") {
        // MySQL only returns the last created id
        expect(userIds).toEqual([101]);
      } else if (_dbType === "pg") {
        expect(userIds).toEqual([100, 101]);
      }
      const readStream = dbClient
        .selectFrom("Users")
        .selectAll()
        .where("firstName", "in", ["Yoda", "Obi-Wan Kenobi"])
        .stream();
      const readUserIds: number[] = [];
      for await (const user of readStream) {
        readUserIds.push(user.id);
      }
      // since we are now using read db, no results will be given
      expect(readUserIds.length).toEqual(0);
    });

    it("should always use writer when streaming inside transaction", async () => {
      await dbClient.transaction().execute(async (trx) => {
        const users = [
          { firstName: "Yoda-Trx", id: 105 },
          { firstName: "Obi-Wan Kenobi-Trx", id: 106 },
        ];
        const stream = // write db being used
          _dbType === "pg"
            ? trx.insertInto("Users").values(users).returning("id").stream()
            : trx.insertInto("Users").values(users).stream();
        const userIds: number[] = [];
        for await (const result of stream) {
          const userId = "id" in result ? result.id : Number(result.insertId);
          userIds.push(userId);
        }
        if (_dbType === "mysql") {
          // MySQL only returns the last created id
          expect(userIds).toEqual([106]);
        } else if (_dbType === "pg") {
          expect(userIds).toEqual([105, 106]);
        }
        const readStream = trx
          .selectFrom("Users")
          .selectAll()
          .where("firstName", "in", ["Yoda-Trx", "Obi-Wan Kenobi-Trx"])
          .stream();
        const readUserIds: number[] = [];
        for await (const user of readStream) {
          readUserIds.push(user.id);
        }
        // since we are now inside a transaction, we will use write db, meaning all created users will be returned
        expect(readUserIds).toEqual([105, 106]);
      });
    });

    it("should rollback transactions when error is thrown", async () => {
      await dbClient
        .transaction()
        .execute(async (trx) => {
          await trx
            .insertInto("Users")
            .values([{ firstName: "Luke Skywalker", id: 200 }])
            .execute();
          const userRow = await trx
            .selectFrom("Users")
            .selectAll()
            .where("id", "=", 200)
            .executeTakeFirstOrThrow();
          expect(userRow.firstName).toEqual("Luke Skywalker");
          throw new Error("Transaction error");
        })
        .catch((e: Error) => expect(e.message).toEqual("Transaction error"));
      // since transaction was used => writeDb. So this query should get result if error not thrown
      const userRow = await writeDb
        .selectFrom("Users")
        .selectAll()
        .where("id", "=", 200)
        .executeTakeFirst();
      expect(userRow).toBe(undefined);
    });

    it("can sucessfully destroy the pool resources", async () => {
      await dbClient.destroy();
      const writeDbPromise = writeDb
        .selectFrom("Users")
        .selectAll()
        .where("id", "=", 200)
        .executeTakeFirst();
      if (_dbType === "mysql")
        await expect(writeDbPromise).rejects.toThrowError("Pool is closed");
      if (_dbType === "pg")
        await expect(writeDbPromise).rejects.toThrowError(
          "Cannot use a pool after calling end on the pool",
        );
      const readDbPromise = readDb
        .selectFrom("Users")
        .selectAll()
        .where("id", "=", 200)
        .executeTakeFirst();
      if (_dbType === "mysql")
        await expect(readDbPromise).rejects.toThrowError("Pool is closed");
      if (_dbType === "pg")
        await expect(readDbPromise).rejects.toThrowError(
          "Cannot use a pool after calling end on the pool",
        );
    });
  },
);
