# Turning on MongoDB authentication

**Why:** every business on this VPS shares one MongoDB. Without authentication,
anyone who compromises *one* tenant's API container can read and change
*every* tenant's books. Each business was separated only by the database
name its app happened to pick.

With `MONGO_AUTH=on`:

- `mongod` requires a login, and uses a replica-set keyfile.
- The control plane and backup job log in as `root`.
- Each tenant's API logs in as `app_<slug>`, which can read and write
  **only** `semivra_<slug>`.

While it is off, each tenant API logs a warning at start-up and the control
panel's health card says so. Nothing stops running because of it.

**Status: built, not yet rehearsed.** No Docker was available where this was
written. Do this on staging first. On an existing deployment, doing the steps
out of order locks every tenant out at once.

---

## New deployment (no data yet)

1. In `platform/.env`:
   ```
   MONGO_AUTH=on
   MONGO_ROOT_PASSWORD=<openssl rand -hex 24>
   MONGO_KEYFILE_CONTENT=<openssl rand -base64 756 | tr -d '\n'>
   MONGO_BACKUP_URI=mongodb://root:<MONGO_ROOT_PASSWORD>@mongo:27017/?replicaSet=rs0&authSource=admin
   ```
2. Create the root user. On an empty data directory, the `mongo` image creates
   it from `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD`, so set
   those two to the same values as `MONGO_ROOT_USER` and `MONGO_ROOT_PASSWORD`
   for the first boot.
3. Run `docker compose up -d`. Tenants you create from now on get their own user
   automatically (see `tenantMongoUri` in `control-plane/server.js`).

## Existing deployment (tenants already running)

**Step 1: take a verified backup.**
```bash
docker compose exec backup bash -c 'ls -lt /backups | head -3'
bash platform/restore-drill.sh
```
Do not continue unless the drill says `DRILL PASSED`.

**Step 2: create the users while auth is still OFF.** This only adds users and
rewrites each tenant's `MONGO_URI`. Nothing is enforced yet, and the old
settings are kept in `tenants/<slug>/.env.pre-auth`.
```bash
# In platform/.env set MONGO_ROOT_PASSWORD and MONGO_KEYFILE_CONTENT, leave MONGO_AUTH=off
bash platform/mongo-auth-migrate.sh
```

**Step 3: restart each tenant on its new credentials, auth still off.**
Everything should keep working, because an unauthenticated server accepts
logins too. This proves each URI is well-formed before you depend on it.
```bash
for d in platform/tenants/*/; do docker compose -p "semivra-$(basename $d)" --env-file "$d.env" -f platform/tenant-compose.yml up -d; done
```
Open each business and ring up a test sale.

**Step 4: switch it on.**
```bash
# platform/.env: MONGO_AUTH=on, and MONGO_BACKUP_URI with the root login (see above)
cd platform && docker compose up -d mongo control-plane backup
```
Then restart each tenant again, as in step 3.

**Step 5: verify.**
- Each business logs in and completes a sale.
- A connection with no credentials is refused:
  ```bash
  docker exec semivra-platform-mongo-1 mongosh --quiet --eval 'db.adminCommand({listDatabases:1})'
  ```
  This must fail with an authentication error.
- A tenant's user cannot see another tenant's data: log in as `app_<a>` and
  read from `semivra_<b>`. The read must fail.
- `make backup-status` shows a fresh `LAST_SUCCESS` after the next run.

## Rolling back

Set `MONGO_AUTH=off` in `platform/.env`, run `docker compose up -d mongo`, and
restart the tenants. The users stay, and they're harmless while auth is off.
To go fully back, restore `tenants/<slug>/.env` from `.env.pre-auth`.

## Single-business deployment (root `docker-compose.yml`)

The single-business stack runs one API against the database, so it needs a root
user and no per-tenant users.

1. Take a verified backup, as in step 1 above.
2. While auth is still off, create the root user:
   ```bash
   docker compose exec mongo mongosh --quiet --eval      "db.getSiblingDB('admin').createUser({user:'root', pwd:'<MONGO_ROOT_PASSWORD>', roles:['root']})"
   ```
3. In the root `.env`, set `MONGO_ROOT_PASSWORD`, `MONGO_KEYFILE_CONTENT` and
   `MONGO_AUTH=on`. Point the API and the backup job at the login:
   ```
   MONGO_URI=mongodb://root:<password>@mongo:27017/<db>?replicaSet=rs0&authSource=admin
   MONGO_BACKUP_URI=mongodb://root:<password>@mongo:27017/?replicaSet=rs0&authSource=admin
   ```
4. Run `docker compose up -d`, then verify a sale goes through, and that
   `docker compose exec mongo mongosh --quiet --eval 'db.adminCommand({listDatabases:1})'`
   is refused.

To roll back, set `MONGO_AUTH=off` and restore the old `MONGO_URI`.

