# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim as builder

RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    openssh-client \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./
RUN npm install && npm rebuild

COPY . .

RUN npm run build

# Runtime stage
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    openssh-client \
    tmux \
    libevent-2.1-7 \
    libevent-core-2.1-7 \
    libtinfo6 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /root/.ssh && \
    echo "Host *" > /root/.ssh/config && \
    echo "  StrictHostKeyChecking accept-new" >> /root/.ssh/config && \
    echo "  BatchMode yes" >> /root/.ssh/config && \
    echo "  ConnectTimeout 5" >> /root/.ssh/config && \
    chmod 600 /root/.ssh/config

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/templates ./templates
COPY src ./src

EXPOSE 5000

CMD ["npm", "run", "start"]
