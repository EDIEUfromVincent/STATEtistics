FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV TABPFN_PYTHON=/opt/tabpfn-client/bin/python
ENV TABPFN_CLIENT_CI_MODE=true
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-tabpfn.txt ./
RUN python3 -m venv /opt/tabpfn-client \
    && /opt/tabpfn-client/bin/pip install --no-cache-dir --disable-pip-version-check -r requirements-tabpfn.txt \
    && chown -R node:node /opt/tabpfn-client

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts

USER node
EXPOSE 8080

CMD ["npm", "run", "start"]
