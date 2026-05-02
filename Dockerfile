FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git cmake build-essential \
    libssl-dev libzip-dev libplist-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://github.com/zhlynn/zsign.git /tmp/zsign && \
    cd /tmp/zsign && \
    cmake -B build && cmake --build build -j$(nproc) && \
    cp build/zsign /usr/local/bin/zsign && \
    chmod +x /usr/local/bin/zsign && \
    rm -rf /tmp/zsign

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
