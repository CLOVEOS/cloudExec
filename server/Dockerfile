# One image for both the API (`node server.js`) and the workers (`node worker.js`).
FROM node:20-slim

# Docker CLI only (no daemon): workers talk to the host daemon via
# /var/run/docker.sock, a DinD sidecar, or a remote DOCKER_HOST.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

ENV NODE_ENV=production PORT=8000
EXPOSE 8000 9100
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1
CMD ["node", "server.js"]
