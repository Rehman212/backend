FROM node:22

WORKDIR /app

RUN apt-get update && apt-get install -y \
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
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 4000

CMD ["npm","run","start:prod"]