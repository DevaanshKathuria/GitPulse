# Free Production Deployment

GitPulse can run on one Oracle Cloud Always Free ARM instance without external database or search services. The production stack includes PostgreSQL, Redis, Qdrant, Elasticsearch, Ollama, the API, the web app, and Caddy.

Ollama runs `mxbai-embed-large` for embeddings and `qwen2.5-coder:3b` for pull request summaries. This avoids paid OpenAI requests. Retrieval quality and latency will differ from the OpenAI benchmark in `docs/benchmarks.md`.

## Free-tier constraints

Oracle currently documents these Always Free limits for Ampere A1 compute:

- 2 OCPUs and 12 GB memory in total
- 200 GB combined boot and block storage
- 10 TB outbound data transfer per month

Oracle requires phone verification and, for most users, a credit or debit card. Oracle states that the card is not charged unless the account is upgraded. Always Free capacity is region-dependent, and idle instances may be reclaimed.

Do not upgrade the account or create resources that are not marked Always Free eligible if the goal is zero infrastructure cost.

## 1. Create the VM

In the Oracle Cloud console:

1. Choose the home region carefully because Always Free block storage is tied to it.
2. Create an Ubuntu 24.04 ARM instance using `VM.Standard.A1.Flex`.
3. Allocate 2 OCPUs and 12 GB memory.
4. Use a 100 GB boot volume and confirm that it is marked Always Free eligible.
5. Add an SSH public key and assign a public IPv4 address.
6. Allow inbound TCP 22 from your IP address and TCP 80 and 443 from the internet. Do not expose ports 3000, 3001, 5432, 6379, 6333, 9200, or 11434.

## 2. Install Docker

Connect to the instance:

```bash
ssh ubuntu@YOUR_PUBLIC_IP
```

Install Git and Docker Engine using Docker's official Ubuntu instructions. Confirm that Compose is available:

```bash
git --version
docker --version
docker compose version
```

Add the `ubuntu` user to the Docker group if the installation did not do so, then reconnect before continuing.

## 3. Configure GitPulse

```bash
git clone https://github.com/DevaanshKathuria/GitPulse.git
cd GitPulse
cp .env.production.example .env.production
openssl rand -hex 24
```

Edit `.env.production`:

- Set `POSTGRES_PASSWORD` to the generated hexadecimal value.
- Replace the example IP in `GITPULSE_HOST` with the VM's public IP, using dashes. For `203.0.113.10`, use `gitpulse.203-0-113-10.sslip.io`.
- Add a free fine-grained `GITHUB_TOKEN` if private repositories or full GitHub analytics are needed.
- Leave `OPENAI_API_KEY` empty to use the local Ollama models at no API cost.
- Leave `HUGGINGFACE_API_KEY` empty unless optional cross-encoder reranking is required.

The `sslip.io` hostname resolves to the embedded IP address. Caddy obtains and renews the HTTPS certificate automatically.

## 4. Start the production stack

Validate the resolved configuration without printing the output, because it contains secrets:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
```

Build and start the services:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

The first start downloads the application images and approximately 2.6 GB of Ollama models. Monitor startup with:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f api caddy ollama
```

When every long-running service is healthy, open `https://YOUR_GITPULSE_HOST` and add a public GitHub repository.

## 5. Verify the deployment

```bash
curl --fail https://YOUR_GITPULSE_HOST/health
curl --fail https://YOUR_GITPULSE_HOST/api/v1/repos
```

The health endpoint should return `{"status":"ok"}` and the repository endpoint should return a JSON array.

## Updates

```bash
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Docker volumes preserve PostgreSQL, Redis, Qdrant, Elasticsearch, Ollama models, and Caddy certificates across container replacements.

## Backups and cost safety

- Create an Oracle boot-volume backup before major upgrades. Always Free accounts include a limited number of volume backups.
- Keep only this Always Free VM and its eligible storage unless another resource is intentionally required.
- Check the Oracle cost analysis page after provisioning. The forecast should remain zero.
- Never commit `.env.production`.

Official references:

- [Oracle Cloud Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Oracle Always Free resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [sslip.io DNS service](https://sslip.io/)
