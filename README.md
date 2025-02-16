# kysely-replica-dialect
A Kysely dialect for MySQL and Postgres with support for replicas

[![CI](https://github.com/robinellgrenkysely-replica-dialect/actions/workflows/release.yml/badge.svg)](https://github.com/robinellgren/kysely-replica-dialect/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/kysely-replica-dialect.svg)](https://www.npmjs.com/package/kysely-replica-dialect)

A [Kysely](https://github.com/koskimas/kysely) dialect for [MySQL](https://www.mysql.com) that supports using **read replication**. The dialect uses the [Core MySQL Dialect](https://kysely-org.github.io/kysely-apidoc/classes/MysqlDialect.html) under the hood.

## Features

- ⚡️&nbsp; Well-tested and production ready
- 🍃&nbsp; Light - The dialect has zero dependencies (other than `kysely` itself)
- 🐘🐬&nbsp; Works with both `MySQL` and `Postgres`.
- ✅&nbsp; Easy to add to your existing project

## Read replication

Read replication allows distributing SELECT queries across multiple read replicas while directing all writes and updates to a primary database instance. This can improve read performance and scalability.

`kysely-replica-dialect` adds support for MySQL read replication in Kysely, which [is not available in the main library](https://github.com/kysely-org/kysely/issues/450). You define a primary database for writes and one or more read replicas for queries. Note that `kysely-replica-dialect` does not handle the actual replication setup. That is managed by the database itself.

## Installation

Available in [NPM](https://www.npmjs.com/package/kysely-replica-dialect).

The only required peer-dependency is `kysely`.
You can install the library with your favorite package manager:

```bash
# with pnpm
pnpm add kysely-replica-dialect

# with yarn
yarn add kysely-replica-dialect

# with npm
npm install kysely-replica-dialect
```

## Usage
> Each `write` or `transaction` query will use the `write` pool. For `SELECT`, the `read` pool will be used. Read and write replicas within the pool are switched using the underlying driver (`mysql2` or `pg`).

Since this library uses `kysely` core drivers under the hood, the extra dialect config is passed to there. This means that functionality for use `onCreateConnection` and `onReserveConnection` stays the same.

### MySQL

You can pass a new instance of `MysqlReplicaDialect` as the `dialect` option when creating a new `Kysely` instance:

```typescript
import { Kysely } from "kysely";
import { createPool } from "mysql2";
import { MysqlReplicaDialect } from "kysely-replica-dialect";

const writePool = createPool({
    database: "some_db",
    host: "localhost:3306",
});

const readPool = createPool({
    database: "some_db",
    host: "localhost:3307",
});

const db = new Kysely<DB>({
  dialect: new MysqlReplicaDialect({
    pools: {
      read: readPool,
      write: writePool,
    },
    ...yourOtherDialectConfig,
  }),
});
```

### Postgres

Similarily to Mysql, you can pass a new instance of `PostgresReplicaDialect` as the `dialect` option when creating a new `Kysely` instance:

```typescript
import { Kysely } from "kysely";
import { Pool } from "pg";
import { PostgresReplicaDialect } from "kysely-replica-dialect";

const writePool = Pool({
    database: "some_db",
    host: "localhost:3306",
});

const readPool = Pool({
    database: "some_db",
    host: "localhost:3307",
});

const db = new Kysely<TestDB>({
  dialect: new PostgresReplicaDialect({
    pools: {
      read: readPool,
      write: writePool,
    },
    ...yourOtherDialectConfig,
  }),
});
```

### Pool as function

If you want the pool to only be created once it's first used, pool can be a function (just like in `kysely`):

```typescript
import { createPool } from "mysql2";
import { Pool } from "pg";

new MysqlReplicaDialect({
    pools: {
      read: async () => createPool({ database: "some_db", host: "localhost:3307" }),
      write: async () => createPool({ database: "some_db", host: "localhost:3306" }),
    },
});

new PostgresReplicaDialect({
    pools: {
      read: async () => Pool({ database: "some_db", host: "localhost:3307" }),
      write: async () => Pool({ database: "some_db", host: "localhost:3306" }),
    },
});
```

## Transactions

When using the dialect within a transaction, the `write` pool will **always** be used. This is because there is no way to know beforehand what queries will be executed within the transaction so we cannot decide if read or write pool should be used.