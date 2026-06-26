FROM python:3.11-slim

WORKDIR /app
COPY app.py /app/app.py

ENV PYTHONUNBUFFERED=1
ENV LISTENER_HOST=0.0.0.0
ENV TZONE_TCP_PORT=18801
ENV TZONE_ACK=true

CMD ["python", "/app/app.py"]
