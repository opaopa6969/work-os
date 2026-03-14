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
    tmux \
    libevent-2.1-7 \
    libevent-core-2.1-7 \
    libtinfo6 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /root/.ssh \
    && echo "192.168.1.50 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGD0CMmjQUbnC55k+u4pqmZJPnLYVl08zPNH+plZe+ij" >> /root/.ssh/known_hosts \
    && chmod 600 /root/.ssh/known_hosts

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
