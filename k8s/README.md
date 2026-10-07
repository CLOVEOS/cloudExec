# Kubernetes deployment

```bash
kubectl apply -f k8s/00-namespace-config.yaml
kubectl -n cloudexec create secret generic cloudexec-secrets \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32) \
  --from-literal=SARVAM_API_KEY=<your key> \
  --from-literal=ADMIN_EMAILS=<your email> --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/
```

Kafka and MongoDB are expected as managed services (Confluent Cloud / Amazon MSK /
Strimzi operator, MongoDB Atlas). Point `KAFKA_BROKERS` and `MONGO_URI` in the
ConfigMap at them. Images are published to GHCR by `.github/workflows/ci.yml`.
