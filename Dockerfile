FROM node:22

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
# Do not download Puppeteer's bundled Chrome (~300MB) — it filled the EC2 disk.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2 \
    libcairo2-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpango1.0-dev \
    libjpeg62-turbo \
    libjpeg-dev \
    libgif-dev \
    librsvg2-2 \
    librsvg2-dev \
    libpixman-1-0 \
    fonts-liberation \
    ghostscript \
    poppler-utils \
    poppler-data \
    tesseract-ocr \
    chromium \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install \
    && rm -rf /root/.cache/puppeteer /tmp/*

COPY . .

RUN npm run build \
    && rm -rf /tmp/*

EXPOSE 4000

CMD ["npm","run","start:prod"]
