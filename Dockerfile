FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git make build-essential \
    libssl-dev libzip-dev libplist-dev \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://github.com/zhlynn/zsign.git /tmp/zsign && \
    cd /tmp/zsign && \
    make -j$(nproc) && \
    cp zsign /usr/local/bin/zsign && \
    chmod +x /usr/local/bin/zsign && \
    rm -rf /tmp/zsign

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
