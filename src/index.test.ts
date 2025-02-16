import { MySqlContainer } from "@testcontainers/mysql";
import { Generated, Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import { afterAll, describe, expect, it } from "vitest";

import { MysqlReplicaDialect } from ".";

describe.sequential("mysql replica dialect", async () => {
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

  const getContainerWithPoolAndDb = async () => {
    const container = await new MySqlContainer().start();
    const pool = createPool({
      database: container.getDatabase(),
      host: container.getHost(),
      password: container.getUserPassword(),
      port: container.getPort(),
      user: container.getUsername(),
    });
    const db = new Kysely<TestDB>({
      dialect: new MysqlDialect({
        pool,
      }),
    });
    return { container, db, pool };
  };

  const {
    container: emptyContainer,
    db: emptyDb,
    pool: poolWithEmptyDb,
  } = await getContainerWithPoolAndDb();
  await setupSchema(emptyDb);
  const {
    container: filledContainer,
    db: stuffDb,
    pool: poolWithRows,
  } = await getContainerWithPoolAndDb();
  await setupSchema(stuffDb);
  // So write and read pool are now actually different DBs!
  const pools = {
    read: poolWithEmptyDb,
    write: poolWithRows,
  };
  const dbClient = new Kysely<TestDB>({
    dialect: new MysqlReplicaDialect({ pools }),
  });
  afterAll(async () => {
    await emptyContainer.stop();
    await filledContainer.stop();
  });

  it("should be able switch seamlessly between read and write pool", async () => {
    // Insert uses write db
    const userId = Number(
      (
        await dbClient
          .insertInto("Users")
          .values([{ firstName: "robin" }])
          .executeTakeFirst()
      ).insertId,
    );
    expect(userId).toBe(1);
    // select query => read pool
    const users = await dbClient.selectFrom("Users").selectAll().execute();
    // because of read instance we get 0 results (remember it's really a different db (see setup!)
    expect(users.length).toBe(0);
  });

  it("should always use write pool within transactions", async () => {
    // from within transactions always the write instance is used
    await dbClient.transaction().execute(async (trx) => {
      const userId = Number(
        (
          await trx
            .insertInto("Users")
            .values([{ firstName: "batman" }])
            .executeTakeFirst()
        ).insertId,
      );
      expect(userId).toBe(2); // sequentially running so the user from previous test counts!
      const users = await trx
        .selectFrom("Users")
        .where("firstName", "=", "batman")
        .selectAll()
        .execute();
      // because inside transaction we use write db again and then the result works!
      expect(users.length).toBe(1);
    });
  });

  it("should work as normal mysql dialect when using single pool", async () => {
    const dbWithSinglePool = new Kysely<TestDB>({
      dialect: new MysqlReplicaDialect({ pool: poolWithRows }),
    });
    // insert first
    await dbWithSinglePool
      .insertInto("Pets")
      .values([{ firstName: "Rin-Tin-Tin", ownerId: 1 }])
      .execute();
    // since only one pool, same db instance is used and result works
    const robinsPet = await dbWithSinglePool
      .selectFrom("Pets")
      .selectAll()
      .where("firstName", "=", "Rin-Tin-Tin")
      .executeTakeFirst();
    expect(robinsPet?.ownerId).toBe(1);
  });

  it("should work when write and read is the same pool ", async () => {
    const dbWithSinglePool = new Kysely<TestDB>({
      dialect: new MysqlReplicaDialect({
        pools: { read: poolWithRows, write: poolWithRows },
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
  });
});
