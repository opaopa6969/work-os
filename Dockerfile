# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    openssh-client \
    python3 \
    make \
    g++ \
    libevent-2.1-7 \
    libevent-core-2.1-7 \
    libtinfo6 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
