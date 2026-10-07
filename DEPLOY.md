# Deploying CloudExec as a public service

This guide puts CloudExec on one cloud VM with HTTPS, automatic restarts, backups and push-to-deploy.
Total time is about 30 minutes.

```
Internet ──443──► Caddy (auto HTTPS) ──► web (nginx: SPA + /api proxy) ──► api
                                                                           │
             private Docker network: kafka · mongodb · workers · spark-streaming · spark-batch
```

Only ports 22, 80 and 443 are open. Kafka, MongoDB, the API and the workers are not reachable from the internet.

---

## 1. Create a VM

**Size:** at least **4 vCPU / 8 GB RAM / 40 GB disk**, running **Ubuntu 24.04 or 22.04**. Kafka, MongoDB, two Spark JVMs and the code sandboxes all share this one machine.

| Provider | Instance | Rough cost | Notes |
|---|---|---|---|
| **AWS** | `t3.large` (2 vCPU/8 GB) or `m6i.xlarge` | ~$60–140/mo | AWS Educate / free credits for students |
| **Google Cloud** | `e2-standard-4` | ~$100/mo | $300 free trial credit |
| **Azure** | `B4ms` | ~$120/mo | $100 Azure for Students credit |
| **DigitalOcean** | 8 GB / 4 vCPU droplet | ~$48/mo | GitHub Student Pack credit |
| **Oracle Cloud** | Always Free Ampere A1, 4 OCPU / 24 GB | **free** | ARM CPU; see the note below |

When you create the VM:
- Add your SSH public key (`~/.ssh/id_ed25519.pub`; create one with `ssh-keygen -t ed25519` if you don't have one).
- In the provider's firewall or security group, allow inbound **TCP 22, 80 and 443**.
- Note the VM's **public IP**.

> **Oracle ARM note:** every image used here is published for arm64. This setup was only tested on x86-64, so watch `docker compose logs` on the first start.

## 2. Set up the VM (one command)

```bash
ssh ubuntu@<PUBLIC_IP>
curl -fsSL https://raw.githubusercontent.com/CLOVEOS/cloudExec/main/deploy/setup-vm.sh | bash
exit            # log out and back in so docker works without sudo
```

This installs Docker, **gVisor** (a stronger sandbox for user code), a firewall and 4 GB of swap. It then clones the repo to `~/cloudExec`.

## 3. Configure

```bash
ssh ubuntu@<PUBLIC_IP>
cd ~/cloudExec
nano .env
```

Set at least:

```env
SARVAM_API_KEY=sk_...
JWT_SECRET=<output of: openssl rand -hex 32>
ADMIN_EMAILS=you@example.com
ACME_EMAIL=you@example.com
DOMAIN=13-233-10-20.sslip.io     # your IP with dashes + .sslip.io, or your own domain
SANDBOX_RUNTIME=runsc            # if setup-vm.sh reported gVisor installed
```

**Domain options:**
- **Free, instant:** `<ip-with-dashes>.sslip.io`. For example, IP `13.233.10.20` becomes `13-233-10-20.sslip.io`. It points at your VM automatically, and Caddy gets a real HTTPS certificate for it.
- **Your own domain** (e.g. from Namecheap, or free with the GitHub Student Pack): add an **A record** pointing at the VM's IP, then set `DOMAIN=cloudexec.yourdomain.com`.

## 4. Deploy

```bash
./deploy/deploy.sh
```

The first run builds every image and pulls the sandbox images, which takes 5–10 minutes. Then open `https://<DOMAIN>` and sign up with your admin email.

## 5. Push-to-deploy (CD)

After this, every merge to `main` that passes CI deploys itself.

1. On your laptop, create a deploy key and authorise it on the VM:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/cloudexec_deploy -N ""
   ssh-copy-id -i ~/.ssh/cloudexec_deploy.pub ubuntu@<PUBLIC_IP>
   ```
2. On GitHub, open the repo's **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `DEPLOY_HOST` = VM public IP
   - `DEPLOY_USER` = `ubuntu` (or your VM user)
   - `DEPLOY_SSH_KEY` = the contents of `~/.ssh/cloudexec_deploy` (the private key)
3. Merge something to `main`. The **Deploy** workflow runs `deploy/deploy.sh` on the VM after CI passes. You can also run it by hand from the **Actions** tab.

## 6. Operations

| Task | Command (on the VM, in `~/cloudExec`) |
|---|---|
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f api worker` |
| Restart one service | `docker compose -f docker-compose.prod.yml restart api` |
| Scale workers | set `WORKER_REPLICAS=4` in `.env`, then `./deploy/deploy.sh` |
| Recompute insights now | `docker compose -f docker-compose.prod.yml run --rm spark-batch "spark-submit --master local[2] batch_insights.py --source lake --path /data/lake/executions --mongo-uri mongodb://mongodb:27017"` |
| Backup MongoDB | `./deploy/backup.sh` (keeps the last 7 in `backups/`) |
| Nightly backups | `crontab -e` → `0 3 * * * cd ~/cloudExec && ./deploy/backup.sh >> backups/backup.log 2>&1` |
| Update | `./deploy/deploy.sh` (or merge to `main` once CD is set up) |

## Production checklist

- [ ] `JWT_SECRET` is random (the API refuses to start with a placeholder)
- [ ] `SANDBOX_RUNTIME=runsc` (gVisor) is set, since anyone on the internet can run code
- [ ] Nightly backups are scheduled, and you've copied one off the VM at least once
- [ ] Sarvam usage alerts are set in the Sarvam dashboard; AI calls are limited to 5 per user per minute (`RATE_LIMIT_AI_PER_MIN`)
- [ ] The VM provider's billing alert is on

## Going bigger (Kubernetes)

When one VM isn't enough, `k8s/` contains manifests for managed Kubernetes (GKE / EKS / AKS) with autoscaling API and worker pools, a Spark CronJob, and managed Kafka and MongoDB. CI already publishes images to `ghcr.io/cloveos/cloudexec-*`. See [`k8s/README.md`](k8s/README.md).
