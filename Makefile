.PHONY: up down infra dev-api dev-worker dev-web seed seed-big insights test images-pull

up:            ## full stack in docker
	docker compose up -d --build

down:
	docker compose down

infra:         ## only Kafka + MongoDB (for local development)
	docker compose up -d kafka mongodb

images-pull:   ## pre-pull sandbox images
	for i in python:3.11-slim gcc:12 eclipse-temurin:17-jdk-jammy node:20-slim; do docker pull $$i; done

dev-api:
	cd server && USE_KAFKA=true npm run dev

dev-worker:
	cd server && USE_KAFKA=true npm run worker

dev-web:
	cd client && npm run dev

seed:          ## 200 users, 50k events into MongoDB
	cd server && node scripts/seed.js --users 200 --events 50000 --days 60

seed-big:      ## 2,000 users, 1M events (also streamed through Kafka)
	cd server && USE_KAFKA=true node scripts/seed.js --users 2000 --events 1000000 --days 90 --kafka

insights:      ## run the Spark batch job directly against MongoDB
	spark-submit --packages org.mongodb.spark:mongo-spark-connector_2.12:10.4.0 spark/batch_insights.py --source mongo

test:
	cd server && npm test
	cd client && npm run lint && npm run build
	pytest -q spark/tests
