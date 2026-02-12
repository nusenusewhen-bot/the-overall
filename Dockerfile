# Use official Python 3.12 image (audioop exists here)
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Copy requirements first (cache layer)
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy all your files
COPY . .

# Run the bot
CMD ["python", "main.py"]
