FROM mcr.microsoft.com/playwright/python:v1.64.1-noble
WORKDIR /checks
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY measure.py .
