FROM node:20-bookworm-slim AS build
ENV HUSKY=0
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOME=/home/agent
ENV STATESET_STATE_DIR=/home/agent/.stateset
WORKDIR /app

RUN groupadd --gid 1001 agent     && useradd --uid 1001 --gid 1001 --create-home --home-dir /home/agent --shell /usr/sbin/nologin agent

COPY --from=build --chown=agent:agent /app/package.json ./package.json
COPY --from=build --chown=agent:agent /app/package-lock.json ./package-lock.json
COPY --from=build --chown=agent:agent /app/bin ./bin
COPY --from=build --chown=agent:agent /app/dist ./dist
COPY --from=build --chown=agent:agent /app/node_modules ./node_modules

RUN mkdir -p /home/agent/.stateset && chown -R agent:agent /home/agent /app

USER agent
EXPOSE 3000
CMD ["node", "./bin/stateset-gateway.js", "--no-whatsapp"]
