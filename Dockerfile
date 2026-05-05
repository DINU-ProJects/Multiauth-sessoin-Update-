# Dockerfile
FROM node:18-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create session directory
RUN mkdir -p session message_data

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
