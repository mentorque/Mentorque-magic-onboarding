FROM node:20-alpine

RUN npm install -g pnpm@10.14.0

WORKDIR /app

# Copy dependency manifests first for better layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client/package.json ./lib/api-client/
COPY lib/api-spec/package.json ./lib/api-spec/

# Install only what api-server and its workspace deps need.
RUN pnpm install --frozen-lockfile --filter @workspace/api-server...

# Copy the rest of the source after dependencies are cached.
COPY . .

RUN pnpm --filter @workspace/api-server run build

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
