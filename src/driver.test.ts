import { createPool } from "mysql2";
import { Pool } from "pg";

import { ReplicaDriver } from "./driver";

describe("only mysql and postgres are supported", async () => {
  it("should work to create a driver of postgres", async () => {
    const pool = new Pool({
      database: "some_db",
      host: "localhost:3306",
    });
    const pgDriver = new ReplicaDriver({
      pools: { read: pool, write: pool },
      type: "pg",
    });
    expect(pgDriver).not.toBe(null);
  });

  it("should work to create a driver of mysql", async () => {
    const pool = createPool({
      database: "some_db",
      host: "localhost:3306",
    });
    const mysqlDriver = new ReplicaDriver({
      pools: { read: pool, write: pool },
      type: "mysql",
    });
    expect(mysqlDriver).not.toBe(null);
  });

  it("should throw if type is unknown", async () => {
    expect(
      () =>
        new ReplicaDriver({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pools: {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: "whatever" as any,
        }),
    ).toThrowErrorMatchingInlineSnapshot(
      "[Error: Only MySQL and Postgres are supported]",
    );
  });
});
