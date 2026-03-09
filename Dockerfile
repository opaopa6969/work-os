# syntax=docker/dockerfile:1

FROM node:20-alpine

# ビルドに必要なツールと tmux
RUN apk add --no-cache tmux git curl bash openssh-client python3 make g++

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm install

# ソースのコピー
COPY . .

# ビルド (Next.js + Custom Server)
RUN npm run build

# ポート開放
EXPOSE 3000

# カスタムサーバーの起動
CMD ["npm", "run", "start"]
