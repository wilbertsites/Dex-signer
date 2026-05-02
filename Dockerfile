FROM node:20-slim

# Install zsign build deps
RUN apt-get update && apt-get install -y \
    git cmake build-essential \
    libssl-dev libzip-dev libplist-dev \
    && rm -rf /var/lib/apt/lists/*

# Build zsign from source
RUN git clone --depth=1 https://github.com/zhlynn/zsign.git /tmp/zsign && \
    cd /tmp/zsign && \
    mkdir build && cd build && \
    cmake .. && make -j$(nproc) && \
    cp zsign /usr/local/bin/zsign && \
    chmod +x /usr/local/bin/zsign && \
    rm -rf /tmp/zsign

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
