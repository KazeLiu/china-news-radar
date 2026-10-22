FROM node:22-bookworm-slim
RUN npm install -g pnpm@9.12.1 && useradd --uid 10001 --create-home reader && mkdir /state && chown reader:reader /state
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
COPY client-next/package.json ./client-next/package.json
COPY rsshub-service/package.json ./rsshub-service/package.json
COPY telegram-collector/package.json ./telegram-collector/package.json
RUN pnpm install --filter radar-telegram-collector --prod --frozen-lockfile
COPY telegram-collector/*.cjs ./telegram-collector/
WORKDIR /app/telegram-collector
USER reader
ENV TG_STATE_DIR=/state TG_NODE_SESSION=/state/reader.node-session
CMD ["node", "main.cjs"]
