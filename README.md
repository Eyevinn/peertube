# PeerTube for Eyevinn Open Source Cloud

Container packaging of [PeerTube](https://joinpeertube.org), the federated (ActivityPub) video platform, for one-click deployment in [Eyevinn Open Source Cloud](https://www.osaas.io) (OSC).

It wraps the official `chocobozzz/peertube` image and adds a small entrypoint that turns OSC-style configuration (`DATABASE_URL`, `REDIS_URL`, `S3_*`, `SMTP_*`) into PeerTube's own `PEERTUBE_*` settings. On startup it also creates the object storage bucket and makes the public video prefixes readable.

## Architecture on OSC

| Component | OSC service |
|---|---|
| PeerTube (this repo) | `eyevinn-peertube` |
| Database | PostgreSQL (`birme-osc-postgresql`) |
| Job queue / cache | Valkey (`valkey-io-valkey`) |
| Video storage | MinIO (`minio-minio`) or any S3-compatible storage |
| Email (optional) | OSC workspace mailbox or any SMTP server |

Video files (HLS, web videos, originals, captions, user exports) are stored in object storage, so they survive restarts. Thumbnails, avatars, plugins and logs live under `/data`, which should be mounted on a persistent volume.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:password@host:port/database`. Add `?sslmode=require` for TLS. |
| `REDIS_URL` | yes | `redis://[:password@]host:port[/db]` (`rediss://` for TLS). |
| `ADMIN_EMAIL` | yes | Email address of the `root` administrator. |
| `ADMIN_PASSWORD` | no | Initial `root` password. If not set, PeerTube generates one and prints it in the log on first start. |
| `SECRET` | no | PeerTube secret (`openssl rand -hex 32`). If not set, one is derived from the database location and hostname. |
| `INSTANCE_NAME` | no | Display name of the instance. |
| `SIGNUP_ENABLED` | no | `true` to allow public registration (default `false`). |
| `S3_ENDPOINT` | no | S3 endpoint, e.g. `https://<tenant>-<name>.minio-minio.auto.prod.osaas.io`. Enables object storage. |
| `S3_ACCESS_KEY_ID` | with S3 | S3 access key. |
| `S3_SECRET_ACCESS_KEY` | with S3 | S3 secret key. |
| `S3_BUCKET` | no | Bucket name (default `peertube`). Each file type uses its own prefix. |
| `S3_REGION` | no | Region (default `us-east-1`). |
| `S3_PUBLIC_URL` | no | Public base URL for files, e.g. a CDN in front of the bucket. |
| `S3_CREATE_BUCKET` | no | Create the bucket and public-read policy on startup (default `true`). |
| `SMTP_HOST` | no | SMTP server. Email is disabled when not set. |
| `SMTP_PORT` | no | Default `587`. |
| `SMTP_USER` / `SMTP_PASSWORD` | no | SMTP credentials. |
| `SMTP_FROM` | no | Sender address (default `noreply@<hostname>`). |
| `SMTP_TLS` | no | Implicit TLS (default `true` for port 465, otherwise STARTTLS). |

The public hostname comes from `OSC_HOSTNAME`, which OSC sets automatically. PeerTube listens on `PORT` (default `8080`) behind the OSC TLS proxy.

Any upstream `PEERTUBE_*` variable (see [custom-environment-variables.yaml](https://github.com/Chocobozzz/PeerTube/blob/develop/support/docker/production/config/custom-environment-variables.yaml)) can be set directly and takes precedence over the values derived above.

> The PeerTube hostname is stored in the database and in federated actor IDs. Do not change it after the instance has been created.

## Deploy on OSC

1. Create a PostgreSQL instance, a Valkey instance and a MinIO instance.
2. Store the passwords as service secrets.
3. Create a PeerTube instance:

   ```
   DATABASE_URL=postgresql://peertube:{{secrets.pgpassword}}@<ip>:<port>/peertube
   REDIS_URL=redis://<ip>:<port>
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD={{secrets.peertubeadmin}}
   S3_ENDPOINT=https://<tenant>-<name>.minio-minio.auto.prod.osaas.io
   S3_ACCESS_KEY_ID=<minio root user>
   S3_SECRET_ACCESS_KEY={{secrets.miniopassword}}
   ```

4. Open the instance URL and log in as `root`.

## Run locally

```bash
docker build -t peertube-osc .
docker run --rm -p 8080:8080 \
  -e PEERTUBE_WEBSERVER_HOSTNAME=localhost \
  -e PEERTUBE_WEBSERVER_PORT=8080 \
  -e PEERTUBE_WEBSERVER_HTTPS=false \
  -e DATABASE_URL=postgresql://peertube:secret@db-host:5432/peertube \
  -e REDIS_URL=redis://redis-host:6379 \
  -e ADMIN_EMAIL=you@example.com \
  peertube-osc
```

## Notes and limitations

- MinIO does not enforce per-object ACLs. Files of private and unlisted videos sit under the same public prefixes as public ones and are protected only by their unguessable UUID paths.
- Live streaming over RTMP (ports 1935/1936) is not exposed through the OSC HTTP proxy.
- Upgrade PeerTube by changing the image tag in the `Dockerfile` (Dependabot opens PRs for new releases). Database migrations run automatically on startup.

## License

The packaging in this repository is MIT licensed. PeerTube itself is licensed under [AGPL-3.0](https://github.com/Chocobozzz/PeerTube/blob/develop/LICENSE).
