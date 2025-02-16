# kysely-mysql-replica
A Kysely dialect for MySQL with support for replicas

[![CI](https://github.com/robinellgren/kysely-mysql-replica/actions/workflows/release.yml/badge.svg)](https://github.com/robinellgren/kysely-mysql-replica/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kysely-mysql-replica.svg)](https://www.npmjs.com/package/kysely-mysql-replica)

A [Kysely](https://github.com/koskimas/kysely) dialect for [MySQL](https://www.mysql.com) that supports using **read replication**. The dialect uses the [Core MySQL Dialect](https://kysely-org.github.io/kysely-apidoc/classes/MysqlDialect.html) under the hood.

## Features

- ⚡️&nbsp; Well-tested and production ready.
- 🍃&nbsp; Light - The dialect has zero dependencies (other than `kysely` itself).
- ✅&nbsp; Easy to add to your existing project

## Read replication

Read replication allows distributing SELECT queries across multiple read replicas while directing all writes and updates to a primary database instance. This can improve read performance and scalability.

`kysely-mysql-replica` adds support for MySQL read replication in Kysely, which [is not available in the main library](https://github.com/kysely-org/kysely/issues/450). You define a primary database for writes and one or more read replicas for queries. Note that `kysely-mysql-replica` does not handle the actual replication setup. That is managed by the database itself.

## Installation

Available in [NPM](https://www.npmjs.com/package/kysely-mysql-replica).

The only required peer-dependency is `kysely`.
You can install the library with your favorite package manager:

```bash
# with pnpm
pnpm add kysely-mysql-replica

# with yarn
yarn add kysely-mysql-replica

# with npm
npm install kysely-mysql-replica
```

## Usage
> Each `write` or `transaction` query will use the `write` pool. For `SELECT`, the `read` pool will be used. Read and write replicas within the pool are switched using a basic round robin scheduling (due to `mysql2` pool feature).

You can pass a new instance of `MysqlReplicaDialect` as the `dialect` option when creating a new `Kysely` instance:

```typescript
import { Kysely } from 'kysely';
import { createPool } from 'mysql2';
import { MysqlReplicaDialect } from 'kysely-mysql-replica';

const writePool = createPool({
    database: 'some_db',
    host: 'localhost:3306',
});

const readPool = createPool({
    database: 'some_db',
    host: 'localhost:3307',
});

const db = new Kysely<TestDB>({
  dialect: new MysqlReplicaDialect({
    pools: {
      read: readPool,
      write: writePool,
    },
  }),
});
```

If you want the pool to only be created once it's first used, pool can be a function (just like in `kysely`):

```typescript
import { createPool } from 'mysql2'

new MysqlReplicaDialect({
    pools: {
      read: async () => createPool({ database: "some_db", host: "localhost:3307" }),
      write: async () => createPool({ database: "some_db", host: "localhost:3306" }),
    },
});
```

## Transactions

When using the dialect within a transaction, the `write` pool will **always** be used. This is because there is no way to know beforehand what queries will be executed within the transaction so we cannot decide if read or write pool should be used.