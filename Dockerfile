# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

# ビルドに必要なツールと tmux
RUN apt-get update && apt-get install -y \
    tmux \
    git \
    curl \
    bash \
    openssh-client \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm install

# ソースのコピー
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
