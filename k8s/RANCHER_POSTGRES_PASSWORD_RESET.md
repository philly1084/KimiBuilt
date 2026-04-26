# Rancher Postgres Password Reset

Use this when KimiBuilt shows:

```text
Postgres password authentication failed for user "kimibuilt"
```

The fix is to set the same password in two places:

- the Kubernetes Secret key `kimibuilt-secrets -> POSTGRES_PASSWORD`
- the actual Postgres role password for user `kimibuilt`

Do not delete the `postgres-data` PVC unless losing saved sessions and artifacts is acceptable.

## Rancher UI Steps

### 1. Pick A New Password

Use a long letters-and-numbers password to avoid SQL quoting problems. A 48-character hex password is ideal.

Example format:

```text
4d3f8b6c0e2a9f1d7c5b3a8e6f0d2c4b9a1e7f6d5c3b2a0
```

Keep this value available until all steps are complete.

### 2. Update The Kubernetes Secret

In Rancher:

1. Open the target cluster.
2. Open the `kimibuilt` namespace.
3. Go to **Storage -> Secrets**.
4. Open `kimibuilt-secrets`.
5. Edit the key named `POSTGRES_PASSWORD`.
6. Set it to the new password from step 1.
7. Save.

If Rancher shows YAML instead of a form, add or update this without deleting other keys:

```yaml
stringData:
  POSTGRES_PASSWORD: "PASTE_NEW_PASSWORD_HERE"
```

Kubernetes will store it as base64 in `data` after save.

### 3. Update The Actual Postgres Role

In Rancher:

1. Go to **Workloads -> Pods** in the `kimibuilt` namespace.
2. Open the running pod with label/app name `postgres`.
3. Choose **Execute Shell**.
4. Paste this command, replacing `PASTE_NEW_PASSWORD_HERE` with the same password:

```sh
NEW_PG_PASSWORD='PASTE_NEW_PASSWORD_HERE'
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$POSTGRES_USER\" WITH PASSWORD '$NEW_PG_PASSWORD';"
```

Expected output:

```text
ALTER ROLE
```

### 4. Restart Backend

In Rancher:

1. Go to **Workloads -> Deployments**.
2. Open the `backend` deployment in the `kimibuilt` namespace.
3. Click **Redeploy** or **Restart**.
4. Wait for the backend pod to become ready.

This restart is required because the backend disables Postgres after an auth failure and only reads the refreshed Secret at process startup.

### 5. Verify

Open **Execute Shell** on the `backend` pod and run:

```sh
node -e "const {Client}=require('pg'); const c=new Client({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD}); c.connect().then(()=>c.query('select 1')).then(()=>console.log('postgres ok')).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1);});"
```

Expected output:

```text
postgres ok
```

If it still says `password authentication failed`, the Secret value and the role password do not match. Repeat steps 2 and 3 with one freshly chosen password.

## Rancher Cluster Shell One-Paste Option

If you prefer Rancher's cluster shell, this performs the same reset without relying on local `kubectl`:

```sh
NS=kimibuilt
NEW_PG_PASSWORD="$(openssl rand -hex 24)"
ENCODED="$(printf '%s' "$NEW_PG_PASSWORD" | base64 | tr -d '\n')"

kubectl -n "$NS" patch secret kimibuilt-secrets \
  --type merge \
  -p "{\"data\":{\"POSTGRES_PASSWORD\":\"$ENCODED\"}}"

POSTGRES_POD="$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')"

kubectl -n "$NS" exec "$POSTGRES_POD" -- sh -lc \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -c \"ALTER ROLE \\\"\$POSTGRES_USER\\\" WITH PASSWORD '$NEW_PG_PASSWORD';\""

kubectl -n "$NS" rollout restart deployment/backend
kubectl -n "$NS" rollout status deployment/backend --timeout=180s

echo "New Postgres password:"
echo "$NEW_PG_PASSWORD"
```

Save the printed password in the normal secret/password store.
