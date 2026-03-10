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

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm install

# ソースのコピー
COPY . .

# ポート開放
EXPOSE 3000

# 開発モードで直接起動 (ts-nodeを使用)
# 本番ビルドの不整合を避けるため
CMD ["npm", "run", "dev"]
